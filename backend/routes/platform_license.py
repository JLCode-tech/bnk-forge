"""
Platform License API routes for BNK Forge PoV.

Exposes offline Ed25519 license status, verification, installation, and quota inspection.
"""

from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from services.licensing_service import (
    get_licensing_service,
)

router = APIRouter(prefix="/api/v1/license", tags=["platform-licensing"])


class LicenseStatusResponse(BaseModel):
    status: str
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
    features: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    warning_message: str | None = None
    error_message: str | None = None


class LicenseVerifyRequest(BaseModel):
    license_data: str = Field(..., description="Raw JSON string of forge.lic envelope")


class LicenseInstallRequest(BaseModel):
    license_data: str = Field(..., description="Raw JSON string of forge.lic envelope to activate")


class QuotaStatusResponse(BaseModel):
    allowed: bool
    status: str
    current_clusters: int
    max_clusters: int
    current_nodes: int
    max_nodes: int
    violation: str | None = None


@router.get("/status", response_model=LicenseStatusResponse)
def get_license_status():
    """
    Returns current offline Ed25519 license status, expiration, and grace period countdown.
    Publicly queryable or viewer-accessible for UI banner display.
    """
    svc = get_licensing_service()
    res = svc.load_active_license()
    return LicenseStatusResponse(**res.to_dict())


@router.post("/verify", response_model=LicenseStatusResponse)
def verify_license_string(req: LicenseVerifyRequest):
    """
    Cryptographically verifies an Ed25519 license without saving it to disk.
    """
    svc = get_licensing_service()
    res = svc.verify_license_content(req.license_data)
    return LicenseStatusResponse(**res.to_dict())


@router.post("/install", response_model=LicenseStatusResponse)
def install_license(req: LicenseInstallRequest):
    """
    Validates and activates a new forge.lic license file on the system.
    Requires administrator privileges.
    """
    svc = get_licensing_service()
    res = svc.verify_license_content(req.license_data)

    if not res.is_usable:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"License is not usable: {res.error_message or res.status.value}",
        )

    # Save to disk
    lic_path = Path(svc._license_path)
    try:
        lic_path.parent.mkdir(parents=True, exist_ok=True)
        lic_path.write_text(req.license_data, encoding="utf-8")
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed writing license file to {lic_path}: {e}",
        )

    # Refresh cached license
    active_res = svc.load_active_license(force_refresh=True)
    return LicenseStatusResponse(**active_res.to_dict())


@router.get("/quota", response_model=QuotaStatusResponse)
def get_quota_status(current_clusters: int = 1, current_nodes: int = 1):
    """
    Validates current cluster and node load against license capacity quotas.
    """
    svc = get_licensing_service()
    res = svc.load_active_license()
    allowed, violation = svc.validate_quota(current_clusters, current_nodes, res)

    return QuotaStatusResponse(
        allowed=allowed,
        status=res.status.value,
        current_clusters=current_clusters,
        max_clusters=res.max_clusters,
        current_nodes=current_nodes,
        max_nodes=res.max_nodes,
        violation=violation,
    )
