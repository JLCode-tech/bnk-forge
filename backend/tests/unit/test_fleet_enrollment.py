"""
Unit tests for PKI CA Service, Agent Enrollment Tokens, and Bootstrap Handshake.
Verifies Milestone 2 API, SPIFFE ID SAN issuance, and token lifecycle.
"""

import datetime

import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from core.errors import BadRequestError, UnauthorizedError
from database import Base
from models import User
from models.kubernetes import KubernetesCluster
from models.operator import ConnectedOperator, OperatorRegistrationToken
from services.fleet_enrollment_service import (
    bootstrap_agent,
    generate_enrollment_manifests,
    list_enrollment_tokens,
    mint_enrollment_token,
    renew_agent_certificate,
    revoke_enrollment_token,
    validate_and_consume_token,
)
from services.pki_service import ensure_ca_certificate, get_ca_bundle_pem, sign_agent_csr


@pytest.fixture(autouse=True)
def pki_tmp_dir(tmp_path, monkeypatch):
    """Isolate PKI CA certificates and keys to temporary directory."""
    keys_path = tmp_path / "keys"
    keys_path.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr("services.pki_service.get_keys_dir", lambda: keys_path)
    return keys_path


@pytest.fixture
def db_session():
    """Create in-memory SQLite database session for unit tests."""
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine)
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def test_user(db_session):
    """Fixture user for token creation."""
    user = User(
        username="admin",
        email="admin@example.com",
        hashed_password="dummyhashedpassword",
        role="operator",
        is_active=True,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


def generate_test_csr() -> tuple[str, rsa.RSAPrivateKey]:
    """Helper to generate a test agent RSA key and CSR in PEM format."""
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    subject = x509.Name([
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Test Agent"),
        x509.NameAttribute(NameOID.COMMON_NAME, "forge-agent-node-01"),
    ])
    csr = (
        x509.CertificateSigningRequestBuilder()
        .subject_name(subject)
        .sign(key, hashes.SHA256())
    )
    csr_pem = csr.public_bytes(serialization.Encoding.PEM).decode("utf-8")
    return csr_pem, key


class TestPKIService:
    def test_ca_generation_and_bundle(self):
        ca_cert, ca_key = ensure_ca_certificate()
        assert ca_cert is not None
        assert ca_key is not None
        bundle = get_ca_bundle_pem()
        assert "BEGIN CERTIFICATE" in bundle
        assert "END CERTIFICATE" in bundle

    def test_sign_agent_csr(self):
        csr_pem, _ = generate_test_csr()
        cluster_uuid = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"

        cert_pem, expires_at = sign_agent_csr(
            csr_pem=csr_pem,
            cluster_uuid=cluster_uuid,
            node_name="node-01",
            validity_days=30,
        )

        assert cert_pem is not None
        assert "BEGIN CERTIFICATE" in cert_pem
        assert expires_at > datetime.datetime.now(datetime.UTC)

        # Inspect generated certificate
        cert = x509.load_pem_x509_certificate(cert_pem.encode("utf-8"))
        assert cert.subject.get_attributes_for_oid(NameOID.COMMON_NAME)[0].value == "forge-agent-node-01"

        # Check SPIFFE SAN
        san_ext = cert.extensions.get_extension_for_oid(x509.ExtensionOID.SUBJECT_ALTERNATIVE_NAME)
        uri_names = [name.value for name in san_ext.value if isinstance(name, x509.UniformResourceIdentifier)]
        assert f"spiffe://forge/cluster/{cluster_uuid}" in uri_names

        # Check ClientAuth EKU
        eku_ext = cert.extensions.get_extension_for_oid(x509.ExtensionOID.EXTENDED_KEY_USAGE)
        assert ExtendedKeyUsageOID.CLIENT_AUTH in eku_ext.value


class TestEnrollmentService:
    def test_mint_and_validate_token(self, db_session, test_user):
        raw_token, record = mint_enrollment_token(
            db=db_session,
            user=test_user,
            cluster_name="sydney-prod",
            expires_in_hours=24,
            max_uses=2,
        )

        assert raw_token is not None
        assert record.token_prefix.startswith("frg_enr_")
        assert record.use_count == 0
        assert record.max_uses == 2
        assert record.is_active is True

        # First consumption
        claims, updated_record = validate_and_consume_token(db_session, raw_token)
        assert claims["cluster_name"] == "sydney-prod"
        assert updated_record.use_count == 1

        # Second consumption
        _, updated_record2 = validate_and_consume_token(db_session, raw_token)
        assert updated_record2.use_count == 2

        # Third consumption should fail (exceeded max_uses)
        with pytest.raises(UnauthorizedError, match="maximum allowed uses"):
            validate_and_consume_token(db_session, raw_token)

    def test_revoked_token_fails(self, db_session, test_user):
        raw_token, record = mint_enrollment_token(
            db=db_session,
            user=test_user,
            cluster_name="melbourne-edge",
        )
        revoke_enrollment_token(db_session, token_id=record.id, user=test_user)

        with pytest.raises(UnauthorizedError, match="revoked"):
            validate_and_consume_token(db_session, raw_token)

    def test_bootstrap_handshake_creates_cluster_and_operator(self, db_session, test_user):
        raw_token, _ = mint_enrollment_token(
            db=db_session,
            user=test_user,
            cluster_name="canberra-sovereign",
        )
        csr_pem, _ = generate_test_csr()
        cluster_uuid = "00000000-1111-2222-3333-444444444444"

        res = bootstrap_agent(
            db=db_session,
            raw_token=raw_token,
            csr_pem=csr_pem,
            cluster_uuid=cluster_uuid,
            node_name="control-plane-0",
        )

        assert res["status"] == "enrolled"
        assert res["cluster_uuid"] == cluster_uuid
        assert res["spiffe_id"] == f"spiffe://forge/cluster/{cluster_uuid}"
        assert "BEGIN CERTIFICATE" in res["certificate"]
        assert "BEGIN CERTIFICATE" in res["ca_certificate"]
        assert res["console_url"] == "https://console:17543"

        # Check DB state
        cluster = db_session.query(KubernetesCluster).filter(KubernetesCluster.name == "canberra-sovereign").first()
        assert cluster is not None
        assert cluster.access_method == "agent_push"
        assert cluster.integration_status == "agent_connected"
        assert cluster.connectivity_status == "connected"

        operator = db_session.query(ConnectedOperator).filter(ConnectedOperator.cluster_id == cluster.id).first()
        assert operator is not None
        assert operator.connectivity_mode == "mtls_agent"
        assert operator.is_connected is True

    def test_manifest_generation(self):
        manifests = generate_enrollment_manifests(
            raw_token="jwt.token.mock",
            cluster_name="singapore-ai",
            console_url="https://console:17543",
        )

        assert "helm upgrade --install forge-agent" in manifests["helm_command"]
        assert "--set console.url=\"https://console:17543\"" in manifests["helm_command"]
        assert "--set enrollment.token=\"jwt.token.mock\"" in manifests["helm_command"]
        assert "kubectl apply -f -" in manifests["kubectl_command"]
        assert "jwt.token.mock" in manifests["raw_manifest"]


class TestFleetEnrollmentRoutes:
    def test_create_token_route(self, client, sample_operator_user, operator_headers):
        res = client.post(
            "/api/fleet/enrollment/token",
            json={"cluster_name": "route-test-cluster", "expires_in_hours": 12, "max_uses": 3},
            headers=operator_headers,
        )
        assert res.status_code == 200
        data = res.json()
        assert data["cluster_name"] == "route-test-cluster"
        assert "token" in data
        assert "helm_command" in data
        assert "kubectl_command" in data
        assert data["token_prefix"].startswith("frg_enr_")

    def test_create_token_localhost_self_discovery(self, client, sample_operator_user, operator_headers):
        headers = dict(operator_headers)
        headers["Host"] = "localhost:8080"
        res = client.post(
            "/api/fleet/enrollment/token",
            json={"cluster_name": "local-kind-cluster"},
            headers=headers,
        )
        assert res.status_code == 200
        data = res.json()
        assert "--set console.url=\"https://host.docker.internal:17543\"" in data["helm_command"]

    def test_create_token_explicit_override(self, client, sample_operator_user, operator_headers):
        res = client.post(
            "/api/fleet/enrollment/token",
            json={
                "cluster_name": "airgap-cluster",
                "console_url": "https://10.50.1.10:17543",
            },
            headers=operator_headers,
        )
        assert res.status_code == 200
        data = res.json()
        assert "--set console.url=\"https://10.50.1.10:17543\"" in data["helm_command"]

    def test_list_and_revoke_tokens_route(self, client, sample_operator_user, operator_headers):
        create_res = client.post(
            "/api/fleet/enrollment/token",
            json={"cluster_name": "list-cluster"},
            headers=operator_headers,
        )
        assert create_res.status_code == 200
        token_id = create_res.json()["id"]

        list_res = client.get("/api/fleet/enrollment/tokens", headers=operator_headers)
        assert list_res.status_code == 200
        tokens = list_res.json()
        assert any(t["id"] == token_id for t in tokens)

        del_res = client.delete(f"/api/fleet/enrollment/tokens/{token_id}", headers=operator_headers)
        assert del_res.status_code == 200
        assert del_res.json()["status"] == "revoked"

    def test_ca_bundle_route(self, client):
        res = client.get("/api/fleet/enrollment/ca")
        assert res.status_code == 200
        assert "BEGIN CERTIFICATE" in res.json()["ca_certificate"]

    def test_bootstrap_handshake_route(self, client, sample_operator_user, operator_headers):
        create_res = client.post(
            "/api/fleet/enrollment/token",
            json={"cluster_name": "bootstrap-route-cluster"},
            headers=operator_headers,
        )
        assert create_res.status_code == 200
        raw_token = create_res.json()["token"]

        csr_pem, _ = generate_test_csr()
        bootstrap_res = client.post(
            "/api/fleet/enrollment/bootstrap",
            json={
                "token": raw_token,
                "csr": csr_pem,
                "cluster_uuid": "99999999-aaaa-bbbb-cccc-dddddddddddd",
                "node_name": "worker-01",
            },
        )
        assert bootstrap_res.status_code == 200
        data = bootstrap_res.json()
        assert data["status"] == "enrolled"
        assert data["spiffe_id"] == "spiffe://forge/cluster/99999999-aaaa-bbbb-cccc-dddddddddddd"
        assert "BEGIN CERTIFICATE" in data["certificate"]
        assert "BEGIN CERTIFICATE" in data["ca_certificate"]
        assert data["console_url"] == "https://console:17543"
