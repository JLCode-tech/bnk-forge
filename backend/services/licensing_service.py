"""
Offline Ed25519 Licensing Engine for BNK Forge PoV Platform.

Provides cryptographic license validation for enterprise air-gapped deployments:
  - Offline signature verification using Ed25519 public key
  - 30-day grace period with operational warning state
  - Cluster and node capacity quota enforcement
  - Feature entitlement gating (eBPF, TMM, NATS Leaf, Air-gap)
  - 300s clock drift tolerance for distributed edge clusters
"""

import base64
import json
import logging
import os
import threading
import time
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from enum import StrEnum
from pathlib import Path
from typing import Any

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)

logger = logging.getLogger(__name__)

# Canonical BNK Forge PoV embedded Ed25519 public key (32 bytes raw, base64-encoded)
DEFAULT_EMBEDDED_PUBLIC_KEY_B64 = "0SnG6ca30gpWEIgoiHRkMuYLDaW953FcimK5jdNE9JA="

DEFAULT_GRACE_PERIOD_DAYS = 30
CLOCK_DRIFT_TOLERANCE_SECONDS = 300  # 5 minutes clock skew allowance


class LicenseStatus(StrEnum):
    VALID = "VALID"
    GRACE_PERIOD = "GRACE_PERIOD"
    EXPIRED = "EXPIRED"
    INVALID_SIGNATURE = "INVALID_SIGNATURE"
    NOT_YET_VALID = "NOT_YET_VALID"
    QUOTA_EXCEEDED = "QUOTA_EXCEEDED"
    UNLICENSED = "UNLICENSED"
    CORRUPTED = "CORRUPTED"


@dataclass
class LicensePayload:
    license_id: str
    customer: str
    tier: str  # "enterprise-pov", "enterprise", "community", "evaluation"
    issued_at: int  # Unix timestamp
    expires_at: int  # Unix timestamp
    grace_period_days: int = DEFAULT_GRACE_PERIOD_DAYS
    max_clusters: int = 10
    max_nodes: int = 100
    features: list[str] = field(
        default_factory=lambda: [
            "ebpf_flow_analytics",
            "tmm_dpdk_metrics",
            "nats_leaf_transport",
            "air_gap_registry",
            "drift_detection",
            "ai_gateway_governance",
        ]
    )
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class LicenseVerificationResult:
    status: LicenseStatus
    is_usable: bool
    customer: str | None = None
    tier: str | None = None
    license_id: str | None = None
    issued_at: int | None = None
    expires_at: int | None = None
    days_remaining: int = 0
    grace_days_remaining: int = 0
    grace_period_active: bool = False
    max_clusters: int = 0
    max_nodes: int = 0
    features: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)
    error_message: str | None = None
    warning_message: str | None = None

    def to_dict(self) -> dict[str, Any]:
        res = asdict(self)
        res["status"] = self.status.value
        return res


def canonicalize_payload(payload: dict[str, Any]) -> bytes:
    """
    Produces deterministic canonical JSON bytes (RFC 8785 subset)
    guaranteeing bit-for-bit identical signature payloads across Python and Go.
    """
    return json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")


class LicensingService:
    """
    Offline Ed25519 License Verification Engine.
    """

    def __init__(
        self,
        public_key_b64: str | None = None,
        license_path: str | None = None,
    ):
        self._lock = threading.RLock()
        self._public_key_b64 = (
            public_key_b64 or os.getenv("FORGE_LICENSE_PUBLIC_KEY") or DEFAULT_EMBEDDED_PUBLIC_KEY_B64
        )
        self._license_path = license_path or os.getenv("FORGE_LICENSE_PATH", "/etc/forge/forge.lic")
        self._cached_result: LicenseVerificationResult | None = None
        self._cached_mtime: float = -1.0
        self._pub_key_obj: Ed25519PublicKey | None = None
        self._init_public_key()

    def _init_public_key(self) -> None:
        try:
            pub_bytes = base64.b64decode(self._public_key_b64)
            if len(pub_bytes) != 32:
                raise ValueError(f"Expected 32-byte Ed25519 public key, got {len(pub_bytes)}")
            self._pub_key_obj = Ed25519PublicKey.from_public_bytes(pub_bytes)
        except Exception as e:
            logger.error(f"[Licensing] Failed initializing Ed25519 public key: {e}")
            self._pub_key_obj = None

    @property
    def public_key_b64(self) -> str:
        return self._public_key_b64

    def verify_license_content(
        self,
        raw_content: str | bytes | dict[str, Any],
        now_ts: int | None = None,
    ) -> LicenseVerificationResult:
        """
        Cryptographically validates license envelope content.
        """
        if not self._pub_key_obj:
            return LicenseVerificationResult(
                status=LicenseStatus.CORRUPTED,
                is_usable=False,
                error_message="Licensing engine public key uninitialized",
            )

        now = int(time.time()) if now_ts is None else now_ts

        # Parse outer envelope
        try:
            if isinstance(raw_content, dict):
                envelope = raw_content
            elif isinstance(raw_content, (bytes, bytearray)):
                envelope = json.loads(raw_content.decode("utf-8"))
            elif isinstance(raw_content, str):
                envelope = json.loads(raw_content.strip())
            else:
                raise ValueError("Unsupported license content type")

            if not isinstance(envelope, dict):
                raise ValueError("License file must contain a JSON dictionary envelope")

            payload = envelope.get("payload")
            sig_b64 = envelope.get("signature")

            if not payload or not sig_b64:
                return LicenseVerificationResult(
                    status=LicenseStatus.CORRUPTED,
                    is_usable=False,
                    error_message="Malformed license envelope: missing 'payload' or 'signature'",
                )

            sig_bytes = base64.b64decode(sig_b64)
        except Exception as e:
            return LicenseVerificationResult(
                status=LicenseStatus.CORRUPTED,
                is_usable=False,
                error_message=f"Corrupted license structure: {e}",
            )

        # 1. Cryptographic Ed25519 signature verification
        canonical_bytes = canonicalize_payload(payload)
        try:
            self._pub_key_obj.verify(sig_bytes, canonical_bytes)
        except InvalidSignature:
            return LicenseVerificationResult(
                status=LicenseStatus.INVALID_SIGNATURE,
                is_usable=False,
                customer=payload.get("customer"),
                tier=payload.get("tier"),
                license_id=payload.get("license_id"),
                error_message="Cryptographic verification failed: Ed25519 signature mismatch",
            )
        except Exception as e:
            return LicenseVerificationResult(
                status=LicenseStatus.INVALID_SIGNATURE,
                is_usable=False,
                error_message=f"Signature verification error: {e}",
            )

        # 2. Extract and sanitize payload fields
        license_id = str(payload.get("license_id", "unknown-license"))
        customer = str(payload.get("customer", "Unknown Customer"))
        tier = str(payload.get("tier", "enterprise-pov"))
        issued_at = int(payload.get("issued_at", 0))
        expires_at = int(payload.get("expires_at", 0))
        grace_days = int(payload.get("grace_period_days", DEFAULT_GRACE_PERIOD_DAYS))
        max_clusters = int(payload.get("max_clusters", 10))
        max_nodes = int(payload.get("max_nodes", 100))
        features = list(payload.get("features", []))
        metadata = dict(payload.get("metadata", {}))

        # 3. Clock drift tolerance & Temporal Validity
        drift = CLOCK_DRIFT_TOLERANCE_SECONDS

        # Future issue check
        if issued_at > (now + drift):
            return LicenseVerificationResult(
                status=LicenseStatus.NOT_YET_VALID,
                is_usable=False,
                customer=customer,
                tier=tier,
                license_id=license_id,
                issued_at=issued_at,
                expires_at=expires_at,
                max_clusters=max_clusters,
                max_nodes=max_nodes,
                features=features,
                metadata=metadata,
                error_message=f"License not yet active: issued at {datetime.fromtimestamp(issued_at, UTC).isoformat()}",
            )

        # Active valid license
        if now <= (expires_at + drift):
            days_left = max(0, int((expires_at - now) / 86400))
            return LicenseVerificationResult(
                status=LicenseStatus.VALID,
                is_usable=True,
                customer=customer,
                tier=tier,
                license_id=license_id,
                issued_at=issued_at,
                expires_at=expires_at,
                days_remaining=days_left,
                grace_days_remaining=grace_days,
                grace_period_active=False,
                max_clusters=max_clusters,
                max_nodes=max_nodes,
                features=features,
                metadata=metadata,
            )

        # 4. Grace Period evaluation (30 days default)
        grace_end_ts = expires_at + (grace_days * 86400)
        if now <= (grace_end_ts + drift):
            grace_days_left = max(1, int((grace_end_ts - now) / 86400))
            expiry_str = datetime.fromtimestamp(expires_at, UTC).strftime("%Y-%m-%d")
            warning = (
                f"License expired on {expiry_str}. Operating in {grace_days}-day "
                f"grace period ({grace_days_left} days remaining)."
            )
            return LicenseVerificationResult(
                status=LicenseStatus.GRACE_PERIOD,
                is_usable=True,
                customer=customer,
                tier=tier,
                license_id=license_id,
                issued_at=issued_at,
                expires_at=expires_at,
                days_remaining=0,
                grace_days_remaining=grace_days_left,
                grace_period_active=True,
                max_clusters=max_clusters,
                max_nodes=max_nodes,
                features=features,
                metadata=metadata,
                warning_message=warning,
            )

        # 5. Fully Expired
        expiry_str = datetime.fromtimestamp(expires_at, UTC).strftime("%Y-%m-%d")
        return LicenseVerificationResult(
            status=LicenseStatus.EXPIRED,
            is_usable=False,
            customer=customer,
            tier=tier,
            license_id=license_id,
            issued_at=issued_at,
            expires_at=expires_at,
            days_remaining=0,
            grace_days_remaining=0,
            grace_period_active=False,
            max_clusters=max_clusters,
            max_nodes=max_nodes,
            features=features,
            metadata=metadata,
            error_message=f"License and {grace_days}-day grace period expired on {expiry_str}",
        )

    def load_active_license(self, force_refresh: bool = False) -> LicenseVerificationResult:
        """
        Loads the active license file from disk or environment.
        Uses cached result if mtime has not changed.
        """
        with self._lock:
            # Check environment inline license data
            env_data = os.getenv("FORGE_LICENSE_DATA")
            if env_data:
                return self.verify_license_content(env_data)

            # Discover license file path
            env_path = os.getenv("FORGE_LICENSE_PATH")
            primary_path = env_path or self._license_path
            candidate_paths = [
                primary_path,
                "/etc/forge/forge.lic",
                "/app/forge.lic",
                "./forge.lic",
            ]

            target_path: Path | None = None
            for p_str in candidate_paths:
                p = Path(p_str)
                if p.is_file():
                    target_path = p
                    break

            if not target_path:
                return LicenseVerificationResult(
                    status=LicenseStatus.UNLICENSED,
                    is_usable=False,
                    error_message=f"No forge.lic file found at searched paths: {[str(p) for p in candidate_paths]}",
                )

            try:
                stat = target_path.stat()
                mtime = stat.st_mtime
                if not force_refresh and self._cached_result is not None and mtime == self._cached_mtime:
                    return self._cached_result

                content = target_path.read_text(encoding="utf-8")
                res = self.verify_license_content(content)
                self._cached_result = res
                self._cached_mtime = mtime
                return res
            except Exception as e:
                logger.error(f"[Licensing] Failed reading license file at {target_path}: {e}")
                return LicenseVerificationResult(
                    status=LicenseStatus.CORRUPTED,
                    is_usable=False,
                    error_message=f"Failed reading license file: {e}",
                )

    def validate_quota(
        self,
        current_clusters: int,
        current_nodes: int,
        license_res: LicenseVerificationResult | None = None,
    ) -> tuple[bool, str | None]:
        """
        Validates cluster and node counts against license limits.
        Returns (allowed, violation_reason).
        """
        lic = license_res or self.load_active_license()
        if not lic.is_usable:
            return False, f"Platform unlicensed or expired ({lic.status.value})"

        if lic.max_clusters > 0 and current_clusters > lic.max_clusters:
            return False, (
                f"Cluster quota exceeded: licensed for {lic.max_clusters} clusters, "
                f"currently managing {current_clusters}."
            )

        if lic.max_nodes > 0 and current_nodes > lic.max_nodes:
            return False, (
                f"Node capacity quota exceeded: licensed for {lic.max_nodes} nodes, "
                f"currently tracking {current_nodes} nodes."
            )

        return True, None

    def is_feature_enabled(
        self,
        feature_name: str,
        license_res: LicenseVerificationResult | None = None,
    ) -> bool:
        """
        Checks whether a named feature is entitled in the active license.
        """
        lic = license_res or self.load_active_license()
        if not lic.is_usable:
            return False
        if "*" in lic.features or "all" in lic.features:
            return True
        return feature_name in lic.features

    @staticmethod
    def generate_license(
        payload: dict[str, Any] | LicensePayload,
        private_key_b64: str,
    ) -> str:
        """
        Cryptographic utility for minting signed forge.lic files.
        """
        if isinstance(payload, LicensePayload):
            payload_dict = payload.to_dict()
        else:
            payload_dict = dict(payload)

        priv_bytes = base64.b64decode(private_key_b64)
        priv_key = Ed25519PrivateKey.from_private_bytes(priv_bytes)

        canonical = canonicalize_payload(payload_dict)
        signature = priv_key.sign(canonical)
        sig_b64 = base64.b64encode(signature).decode("ascii")

        envelope = {
            "payload": payload_dict,
            "signature": sig_b64,
        }
        return json.dumps(envelope, indent=2)


# Global singleton instance
_licensing_service_instance: LicensingService | None = None
_instance_lock = threading.Lock()


def get_licensing_service() -> LicensingService:
    global _licensing_service_instance
    if _licensing_service_instance is None:
        with _instance_lock:
            if _licensing_service_instance is None:
                _licensing_service_instance = LicensingService()
    return _licensing_service_instance
