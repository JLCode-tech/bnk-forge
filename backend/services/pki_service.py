"""
Internal PKI and CA service for BNK Forge.
Manages Console Root/Intermediate CA and issues client certificates with SPIFFE SANs for edge agents.
"""

import datetime
import ipaddress
import logging
import os
import threading
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID

from core.config import settings

logger = logging.getLogger(__name__)

_pki_lock = threading.RLock()

_CA_CERT_NAME = "forge_ca.crt"
_CA_KEY_NAME = "forge_ca.key"


def get_keys_dir() -> Path:
    """Return keys directory path, creating it if needed."""
    raw_dir = getattr(settings, "KEYS_DIR", None) or os.environ.get("KEYS_DIR")
    if raw_dir:
        candidate = Path(raw_dir)
        try:
            candidate.mkdir(parents=True, exist_ok=True)
            return candidate
        except (PermissionError, OSError):
            logger.warning("Configured KEYS_DIR %s is not writable, falling back to workspace keys dir", candidate)

    # Local fallback inside backend workspace
    base = Path(__file__).resolve().parent.parent
    keys_dir = base / "keys"
    keys_dir.mkdir(parents=True, exist_ok=True)
    return keys_dir


def ensure_ca_certificate() -> tuple[x509.Certificate, rsa.RSAPrivateKey]:
    """Load or initialize the Console Root CA keypair."""
    keys_dir = get_keys_dir()
    cert_path = keys_dir / _CA_CERT_NAME
    key_path = keys_dir / _CA_KEY_NAME

    with _pki_lock:
        if cert_path.exists() and key_path.exists():
            try:
                cert_bytes = cert_path.read_bytes()
                key_bytes = key_path.read_bytes()
                ca_cert = x509.load_pem_x509_certificate(cert_bytes)
                ca_key = serialization.load_pem_private_key(key_bytes, password=None)
                if isinstance(ca_key, rsa.RSAPrivateKey):
                    return ca_cert, ca_key
            except Exception as e:
                logger.warning("Failed loading existing CA (%s), regenerating: %s", cert_path, e)

        # Generate new CA Keypair
        ca_key = rsa.generate_private_key(
            public_exponent=65537,
            key_size=4096,
        )

        subject = issuer = x509.Name([
            x509.NameAttribute(NameOID.COUNTRY_NAME, "US"),
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, "F5 BNK Forge"),
            x509.NameAttribute(NameOID.COMMON_NAME, "BNK Forge Root CA"),
        ])

        now = datetime.datetime.now(datetime.UTC)
        ca_cert = (
            x509.CertificateBuilder()
            .subject_name(subject)
            .issuer_name(issuer)
            .public_key(ca_key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(now - datetime.timedelta(minutes=5))
            .not_valid_after(now + datetime.timedelta(days=3650))  # 10 years
            .add_extension(
                x509.BasicConstraints(ca=True, path_length=None),
                critical=True,
            )
            .add_extension(
                x509.KeyUsage(
                    digital_signature=True,
                    content_commitment=False,
                    key_encipherment=False,
                    data_encipherment=False,
                    key_agreement=False,
                    key_cert_sign=True,
                    crl_sign=True,
                    encipher_only=False,
                    decipher_only=False,
                ),
                critical=True,
            )
            .sign(ca_key, hashes.SHA256())
        )

        cert_bytes = ca_cert.public_bytes(serialization.Encoding.PEM)
        key_bytes = ca_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        )

        cert_path.write_bytes(cert_bytes)
        key_path.write_bytes(key_bytes)
        # Also maintain ca.crt alias for standard tooling & forge-ingest
        alias_cert = keys_dir / "ca.crt"
        alias_key = keys_dir / "ca.key"
        alias_cert.write_bytes(cert_bytes)
        alias_key.write_bytes(key_bytes)
        try:
            os.chmod(cert_path, 0o644)
            os.chmod(alias_cert, 0o644)
            os.chmod(key_path, 0o644)
            os.chmod(alias_key, 0o644)
        except OSError:
            pass

        logger.info("Initialized new BNK Forge Root CA at %s and %s", cert_path, alias_cert)
        return ca_cert, ca_key


def ensure_server_certificate(
    server_names: list[str] | None = None,
    validity_days: int = 365,
) -> tuple[x509.Certificate, rsa.RSAPrivateKey]:
    """Ensure TLS server certificate keypair exists in KEYS_DIR for forge-ingest and reverse proxies.

    Signs with the Console Root CA. Generates server.crt and server.key.
    """
    keys_dir = get_keys_dir()
    cert_path = keys_dir / "server.crt"
    key_path = keys_dir / "server.key"

    with _pki_lock:
        if cert_path.exists() and key_path.exists():
            try:
                cert_bytes = cert_path.read_bytes()
                key_bytes = key_path.read_bytes()
                srv_cert = x509.load_pem_x509_certificate(cert_bytes)
                srv_key = serialization.load_pem_private_key(key_bytes, password=None)
                if isinstance(srv_key, rsa.RSAPrivateKey):
                    return srv_cert, srv_key
            except Exception as e:
                logger.warning("Failed loading existing server keypair (%s), regenerating: %s", cert_path, e)

        ca_cert, ca_key = ensure_ca_certificate()

        srv_key = rsa.generate_private_key(
            public_exponent=65537,
            key_size=2048,
        )

        subject = x509.Name([
            x509.NameAttribute(NameOID.COUNTRY_NAME, "US"),
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, "F5 BNK Forge"),
            x509.NameAttribute(NameOID.COMMON_NAME, "forge-gateway"),
        ])

        # Assemble SANs
        sans: list[x509.GeneralName] = [
            x509.DNSName("localhost"),
            x509.DNSName("forge-ingest"),
            x509.DNSName("host.docker.internal"),
            x509.DNSName("console"),
            x509.DNSName("backend"),
            x509.IPAddress(ipaddress.IPv4Address("127.0.0.1")),
            x509.IPAddress(ipaddress.IPv4Address("0.0.0.0")),
        ]

        # Add any extra names from argument or environment
        all_extra: list[str] = list(server_names or [])
        env_san = os.getenv("FORGE_GATEWAY_SAN")
        if env_san:
            for s in env_san.split(","):
                s = s.strip()
                if s and s not in all_extra:
                    all_extra.append(s)

        for name in all_extra:
            try:
                ip_addr = ipaddress.ip_address(name)
                sans.append(x509.IPAddress(ip_addr))
            except ValueError:
                sans.append(x509.DNSName(name))

        now = datetime.datetime.now(datetime.UTC)
        srv_cert = (
            x509.CertificateBuilder()
            .subject_name(subject)
            .issuer_name(ca_cert.subject)
            .public_key(srv_key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(now - datetime.timedelta(minutes=5))
            .not_valid_after(now + datetime.timedelta(days=validity_days))
            .add_extension(
                x509.BasicConstraints(ca=False, path_length=None),
                critical=True,
            )
            .add_extension(
                x509.KeyUsage(
                    digital_signature=True,
                    content_commitment=False,
                    key_encipherment=True,
                    data_encipherment=False,
                    key_agreement=False,
                    key_cert_sign=False,
                    crl_sign=False,
                    encipher_only=False,
                    decipher_only=False,
                ),
                critical=True,
            )
            .add_extension(
                x509.ExtendedKeyUsage([
                    ExtendedKeyUsageOID.SERVER_AUTH,
                ]),
                critical=False,
            )
            .add_extension(
                x509.SubjectAlternativeName(sans),
                critical=False,
            )
            .sign(ca_key, hashes.SHA256())
        )

        cert_bytes = srv_cert.public_bytes(serialization.Encoding.PEM)
        key_bytes = srv_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        )

        cert_path.write_bytes(cert_bytes)
        key_path.write_bytes(key_bytes)
        try:
            os.chmod(cert_path, 0o644)
            os.chmod(key_path, 0o644)
        except OSError:
            pass

        logger.info("Initialized new BNK Forge Server TLS keypair at %s", cert_path)
        return srv_cert, srv_key


def get_ca_bundle_pem() -> str:
    """Return the Console Root CA certificate in PEM format."""
    ca_cert, _ = ensure_ca_certificate()
    return ca_cert.public_bytes(serialization.Encoding.PEM).decode("utf-8")


def sign_agent_csr(
    csr_pem: str,
    cluster_uuid: str,
    node_name: str = "node",
    validity_days: int = 30,
) -> tuple[str, datetime.datetime]:
    """Sign an agent CSR and issue an X.509 client certificate with SPIFFE SAN.

    Returns:
        Tuple of (signed_cert_pem, not_valid_after)
    """
    ca_cert, ca_key = ensure_ca_certificate()

    csr = x509.load_pem_x509_csr(csr_pem.encode("utf-8"))
    if not csr.is_signature_valid:
        raise ValueError("Invalid CSR signature")

    now = datetime.datetime.now(datetime.UTC)
    expires_at = now + datetime.timedelta(days=validity_days)

    spiffe_uri = f"spiffe://forge/cluster/{cluster_uuid}"
    subject_cn = f"forge-agent-{node_name}"

    subject = x509.Name([
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, "F5 BNK Forge Edge Agent"),
        x509.NameAttribute(NameOID.COMMON_NAME, subject_cn),
    ])

    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(ca_cert.subject)
        .public_key(csr.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(minutes=5))
        .not_valid_after(expires_at)
        .add_extension(
            x509.BasicConstraints(ca=False, path_length=None),
            critical=True,
        )
        .add_extension(
            x509.KeyUsage(
                digital_signature=True,
                content_commitment=False,
                key_encipherment=True,
                data_encipherment=False,
                key_agreement=False,
                key_cert_sign=False,
                crl_sign=False,
                encipher_only=False,
                decipher_only=False,
            ),
            critical=True,
        )
        .add_extension(
            x509.ExtendedKeyUsage([
                ExtendedKeyUsageOID.CLIENT_AUTH,
            ]),
            critical=False,
        )
        .add_extension(
            x509.SubjectAlternativeName([
                x509.UniformResourceIdentifier(spiffe_uri),
                x509.DNSName(f"agent-{cluster_uuid[:8]}"),
            ]),
            critical=False,
        )
        .sign(ca_key, hashes.SHA256())
    )

    cert_pem = cert.public_bytes(serialization.Encoding.PEM).decode("utf-8")
    return cert_pem, expires_at
