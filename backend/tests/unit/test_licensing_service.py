"""
Unit tests for the Offline Ed25519 Licensing Engine and Platform License API.
"""

import base64
import json
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from database import get_db
from main import app
from services.licensing_service import (
    CLOCK_DRIFT_TOLERANCE_SECONDS,
    DEFAULT_EMBEDDED_PUBLIC_KEY_B64,
    LicensePayload,
    LicenseStatus,
    LicensingService,
    canonicalize_payload,
)

# Canonical 32-byte Ed25519 private key matching DEFAULT_EMBEDDED_PUBLIC_KEY_B64
TEST_PRIV_KEY_B64 = "qvYZ84ClRBZ5QyV/n9hak+UJ2Jof3KFw1ZZJPG0ZO6c="


@pytest.fixture
def licensing_service():
    return LicensingService(public_key_b64=DEFAULT_EMBEDDED_PUBLIC_KEY_B64)


@pytest.fixture
def sample_payload():
    now = int(time.time())
    return {
        "license_id": "lic-pov-viettel-001",
        "customer": "Viettel",
        "tier": "enterprise-pov",
        "issued_at": now - 3600,
        "expires_at": now + (86400 * 30),
        "grace_period_days": 30,
        "max_clusters": 5,
        "max_nodes": 50,
        "features": [
            "ebpf_flow_analytics",
            "tmm_dpdk_metrics",
            "nats_leaf_transport",
            "air_gap_registry",
            "drift_detection",
        ],
        "metadata": {
            "poc_lead": "F5 Solutions Architecture",
            "contact": "security@viettel.vn",
        },
    }


class TestLicensingService:
    def test_canonical_json_determinism(self, sample_payload):
        b1 = canonicalize_payload(sample_payload)
        # Reorder keys
        reordered = {k: sample_payload[k] for k in sorted(sample_payload.keys(), reverse=True)}
        b2 = canonicalize_payload(reordered)
        assert b1 == b2

    def test_valid_license_verification(self, licensing_service, sample_payload):
        lic_json = LicensingService.generate_license(sample_payload, TEST_PRIV_KEY_B64)
        result = licensing_service.verify_license_content(lic_json)

        assert result.status == LicenseStatus.VALID
        assert result.is_usable is True
        assert result.customer == "Viettel"
        assert result.tier == "enterprise-pov"
        assert result.grace_period_active is False
        assert 29 <= result.days_remaining <= 31
        assert result.grace_days_remaining == 30
        assert "ebpf_flow_analytics" in result.features

    def test_grace_period_verification(self, licensing_service, sample_payload):
        now = int(time.time())
        # Expired 10 days ago, 30-day grace period means 20 grace days left
        sample_payload["issued_at"] = now - (86400 * 40)
        sample_payload["expires_at"] = now - (86400 * 10)
        sample_payload["grace_period_days"] = 30

        lic_json = LicensingService.generate_license(sample_payload, TEST_PRIV_KEY_B64)
        result = licensing_service.verify_license_content(lic_json)

        assert result.status == LicenseStatus.GRACE_PERIOD
        assert result.is_usable is True
        assert result.grace_period_active is True
        assert result.days_remaining == 0
        assert 19 <= result.grace_days_remaining <= 21
        assert result.warning_message is not None
        assert "grace period" in result.warning_message

    def test_fully_expired_license(self, licensing_service, sample_payload):
        now = int(time.time())
        # Expired 45 days ago, grace period was 30 days
        sample_payload["issued_at"] = now - (86400 * 100)
        sample_payload["expires_at"] = now - (86400 * 45)
        sample_payload["grace_period_days"] = 30

        lic_json = LicensingService.generate_license(sample_payload, TEST_PRIV_KEY_B64)
        result = licensing_service.verify_license_content(lic_json)

        assert result.status == LicenseStatus.EXPIRED
        assert result.is_usable is False
        assert result.days_remaining == 0
        assert result.grace_days_remaining == 0
        assert result.error_message is not None

    def test_tampered_payload_rejected(self, licensing_service, sample_payload):
        lic_json = LicensingService.generate_license(sample_payload, TEST_PRIV_KEY_B64)
        envelope = json.loads(lic_json)
        # Tamper payload
        envelope["payload"]["customer"] = "Malicious Entity"
        tampered_json = json.dumps(envelope)

        result = licensing_service.verify_license_content(tampered_json)
        assert result.status == LicenseStatus.INVALID_SIGNATURE
        assert result.is_usable is False
        assert "mismatch" in result.error_message.lower()

    def test_clock_drift_tolerance(self, licensing_service, sample_payload):
        now = int(time.time())
        # Expired 2 minutes ago (within 300s clock skew tolerance)
        sample_payload["expires_at"] = now - 120

        lic_json = LicensingService.generate_license(sample_payload, TEST_PRIV_KEY_B64)
        result = licensing_service.verify_license_content(lic_json)
        assert result.status == LicenseStatus.VALID
        assert result.is_usable is True

    def test_not_yet_valid_license(self, licensing_service, sample_payload):
        now = int(time.time())
        # Issued 2 days in the future
        sample_payload["issued_at"] = now + (86400 * 2)

        lic_json = LicensingService.generate_license(sample_payload, TEST_PRIV_KEY_B64)
        result = licensing_service.verify_license_content(lic_json)
        assert result.status == LicenseStatus.NOT_YET_VALID
        assert result.is_usable is False

    def test_quota_validation(self, licensing_service, sample_payload):
        sample_payload["max_clusters"] = 3
        sample_payload["max_nodes"] = 25

        lic_json = LicensingService.generate_license(sample_payload, TEST_PRIV_KEY_B64)
        result = licensing_service.verify_license_content(lic_json)

        # Valid quota
        allowed, msg = licensing_service.validate_quota(3, 20, result)
        assert allowed is True
        assert msg is None

        # Exceed cluster quota
        allowed, msg = licensing_service.validate_quota(4, 20, result)
        assert allowed is False
        assert "Cluster quota exceeded" in msg

        # Exceed node quota
        allowed, msg = licensing_service.validate_quota(2, 30, result)
        assert allowed is False
        assert "Node capacity quota exceeded" in msg

    def test_feature_entitlement(self, licensing_service, sample_payload):
        lic_json = LicensingService.generate_license(sample_payload, TEST_PRIV_KEY_B64)
        result = licensing_service.verify_license_content(lic_json)

        assert licensing_service.is_feature_enabled("ebpf_flow_analytics", result) is True
        assert licensing_service.is_feature_enabled("tmm_dpdk_metrics", result) is True
        assert licensing_service.is_feature_enabled("unlicensed_capability", result) is False

    def test_file_load_and_disk_cache(self, tmp_path, sample_payload):
        lic_file = tmp_path / "forge.lic"
        lic_json = LicensingService.generate_license(sample_payload, TEST_PRIV_KEY_B64)
        lic_file.write_text(lic_json, encoding="utf-8")

        svc = LicensingService(
            public_key_b64=DEFAULT_EMBEDDED_PUBLIC_KEY_B64,
            license_path=str(lic_file),
        )

        res = svc.load_active_license()
        assert res.status == LicenseStatus.VALID
        assert res.customer == "Viettel"


class TestPlatformLicenseRoutes:
    def test_verify_license_route(self, sample_payload):
        client = TestClient(app)
        lic_json = LicensingService.generate_license(sample_payload, TEST_PRIV_KEY_B64)

        resp = client.post("/api/v1/license/verify", json={"license_data": lic_json})
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "VALID"
        assert data["customer"] == "Viettel"
        assert data["is_usable"] is True

    def test_status_and_quota_routes(self, sample_payload, tmp_path, monkeypatch):
        lic_file = tmp_path / "forge.lic"
        lic_json = LicensingService.generate_license(sample_payload, TEST_PRIV_KEY_B64)
        lic_file.write_text(lic_json, encoding="utf-8")

        monkeypatch.setenv("FORGE_LICENSE_PATH", str(lic_file))

        client = TestClient(app)
        # GET status
        resp = client.get("/api/v1/license/status")
        assert resp.status_code == 200
        status_data = resp.json()
        assert status_data["is_usable"] is True

        # GET quota
        quota_resp = client.get("/api/v1/license/quota?current_clusters=2&current_nodes=10")
        assert quota_resp.status_code == 200
        quota_data = quota_resp.json()
        assert quota_data["allowed"] is True
