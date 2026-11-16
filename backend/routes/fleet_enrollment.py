"""
Fleet Enrollment and mTLS Handshake API routes.
Enables console-driven agent enrollment, short-lived JWT token minting,
automated CSR signing, and ready-to-run Helm/kubectl command rendering.
"""

import logging
import os
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from core.errors import handle_route_errors
from database import get_db
from models import User
from models.operator import ConnectedOperator
from routes.auth import get_current_user, require_operator, require_viewer
from services.cluster_provider import ClusterDataProvider
from services.fleet_enrollment_service import (
    bootstrap_agent,
    generate_enrollment_manifests,
    list_enrollment_tokens,
    mint_enrollment_token,
    renew_agent_certificate,
    revoke_enrollment_token,
)
from services.pki_service import get_ca_bundle_pem

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/fleet/enrollment", tags=["fleet-enrollment"])


def resolve_console_url(request: Request, override_url: str | None = None) -> str:
    """Intelligently self-discover the external console endpoint for agent enrollment.

    - If explicit override or env var provided, uses it.
    - If accessed from localhost/127.0.0.1 on a laptop, sets host.docker.internal:17543
      so containerized local clusters (Kind, Minikube, Docker Desktop) can route to the host.
    - If accessed via a corporate/LAN IP (e.g. 10.x.x.x), reflects that IP on port 17543.
    - Defaults to https://console:17543.
    """
    if override_url:
        return override_url.rstrip("/")
    env_url = os.getenv("FORGE_CONSOLE_EXTERNAL_URL")
    if env_url:
        return env_url.rstrip("/")

    host_header = request.headers.get("x-forwarded-host") or request.headers.get("host") or ""
    raw_host = host_header.split(":")[0].lower() if host_header else ""

    if raw_host in ("localhost", "127.0.0.1", "0.0.0.0"):
        return "https://host.docker.internal:17543"
    elif raw_host and raw_host != "testserver":
        return f"https://{raw_host}:17543"

    return "https://console:17543"


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class CreateEnrollmentTokenRequest(BaseModel):
    cluster_name: str = Field(..., min_length=1, max_length=255, description="Target cluster name")
    project_id: int | None = Field(None, description="Optional project tenancy scope")
    cluster_id: int | None = Field(None, description="Optional pre-existing cluster ID")
    expires_in_hours: int = Field(24, ge=1, le=720, description="Token validity in hours (default: 24)")
    max_uses: int | None = Field(1, ge=1, description="Max usage count before revocation (default: 1)")
    labels: dict[str, Any] | None = Field(default_factory=dict, description="Metadata tags")
    console_url: str | None = Field(None, description="Optional custom console URL override")


class EnrollmentTokenResponse(BaseModel):
    id: int
    name: str
    token_prefix: str
    token: str
    cluster_name: str
    project_id: int | None
    expires_at: str
    max_uses: int | None
    helm_command: str
    kubectl_command: str


class TokenListItem(BaseModel):
    id: int
    name: str
    token_prefix: str
    use_count: int
    max_uses: int | None
    expires_at: str | None
    is_active: bool
    created_by: str
    created_at: str | None
    labels: dict[str, Any] | None


class BootstrapRequest(BaseModel):
    token: str | None = Field(None, description="Enrollment JWT token (or via Authorization header)")
    csr: str = Field(..., description="Certificate Signing Request in PEM format")
    cluster_uuid: str | None = Field(None, description="Optional cluster UUID")
    node_name: str = Field("node-01", description="Node identifier")
    machine_fingerprint: str | None = Field(None, description="Hardware fingerprint")


class BootstrapResponse(BaseModel):
    status: str
    certificate: str
    ca_certificate: str
    cluster_uuid: str
    spiffe_id: str
    console_url: str
    heartbeat_interval_sec: int
    expires_at: str
    cluster_id: int | None
    cluster_name: str | None


class RenewCertificateRequest(BaseModel):
    csr: str = Field(..., description="New CSR in PEM format")
    cluster_uuid: str = Field(..., description="Target cluster UUID")
    node_name: str = Field("node-01", description="Node identifier")


class RenewCertificateResponse(BaseModel):
    status: str
    certificate: str
    ca_certificate: str
    cluster_uuid: str
    spiffe_id: str
    expires_at: str


class ManifestResponse(BaseModel):
    helm_command: str
    kubectl_command: str
    raw_manifest: str
    cluster_name: str
    console_url: str


class AgentHeartbeatRequest(BaseModel):
    cluster_id: str = Field(..., description="Cluster ID (numeric or UUID)")
    node_name: str = Field("node-01", description="Node identifier")
    agent_id: str | None = Field(None, description="Agent identifier")
    status: str = Field("healthy", description="Agent health status")
    uptime_seconds: int = Field(0, description="Agent uptime in seconds")


class AgentStatusResponse(BaseModel):
    cluster_id: int
    cluster_name: str
    has_active_agent: bool
    connection_mode: str
    status: str | None = None
    connectivity_status: str | None = None
    last_heartbeat_at: str | None = None
    uptime_seconds: int = 0


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post(
    "/token",
    response_model=EnrollmentTokenResponse,
    dependencies=[Depends(require_operator)],
)
@handle_route_errors("mint fleet enrollment token")
def create_token(
    payload: CreateEnrollmentTokenRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Mint a short-lived (24h) enrollment JWT token and generate ready-to-run installation commands."""
    raw_token, record = mint_enrollment_token(
        db=db,
        user=current_user,
        cluster_name=payload.cluster_name,
        project_id=payload.project_id,
        cluster_id=payload.cluster_id,
        expires_in_hours=payload.expires_in_hours,
        max_uses=payload.max_uses,
        labels=payload.labels,
    )

    console_endpoint = resolve_console_url(request, payload.console_url)

    manifests = generate_enrollment_manifests(
        raw_token=raw_token,
        cluster_name=payload.cluster_name,
        console_url=console_endpoint,
    )

    return EnrollmentTokenResponse(
        id=record.id,
        name=record.name,
        token_prefix=record.token_prefix,
        token=raw_token,
        cluster_name=payload.cluster_name,
        project_id=payload.project_id,
        expires_at=record.expires_at.isoformat() if record.expires_at else "",
        max_uses=record.max_uses,
        helm_command=manifests["helm_command"],
        kubectl_command=manifests["kubectl_command"],
    )


@router.get(
    "/tokens",
    response_model=list[TokenListItem],
    dependencies=[Depends(require_viewer)],
)
@handle_route_errors("list fleet enrollment tokens")
def get_tokens(
    project_id: int | None = Query(None, description="Filter by project ID"),
    db: Session = Depends(get_db),
):
    """List active agent enrollment tokens."""
    records = list_enrollment_tokens(db, project_id=project_id)
    return [
        TokenListItem(
            id=r.id,
            name=r.name,
            token_prefix=r.token_prefix,
            use_count=r.use_count,
            max_uses=r.max_uses,
            expires_at=r.expires_at.isoformat() if r.expires_at else None,
            is_active=r.is_active,
            created_by=r.created_by,
            created_at=r.created_at.isoformat() if r.created_at else None,
            labels=r.labels,
        )
        for r in records
    ]


@router.delete(
    "/tokens/{token_id}",
    dependencies=[Depends(require_operator)],
)
@handle_route_errors("revoke fleet enrollment token")
def delete_token(
    token_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Revoke an active enrollment token."""
    revoke_enrollment_token(db, token_id=token_id, user=current_user)
    return {"status": "revoked", "id": token_id}


@router.post(
    "/bootstrap",
    response_model=BootstrapResponse,
)
@handle_route_errors("agent bootstrap handshake")
def bootstrap(
    payload: BootstrapRequest,
    authorization: str | None = Header(None),
    db: Session = Depends(get_db),
):
    """Agent initial enrollment handshake: validates token, signs CSR, returns signed client cert with SPIFFE SAN."""
    token = payload.token
    if not token and authorization:
        parts = authorization.split()
        if len(parts) == 2 and parts[0].lower() == "bearer":
            token = parts[1]

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing enrollment token in body or Authorization header",
        )

    res = bootstrap_agent(
        db=db,
        raw_token=token,
        csr_pem=payload.csr,
        cluster_uuid=payload.cluster_uuid,
        node_name=payload.node_name,
        machine_fingerprint=payload.machine_fingerprint,
    )
    return BootstrapResponse(**res)


@router.post(
    "/renew",
    response_model=RenewCertificateResponse,
)
@handle_route_errors("renew agent certificate")
def renew(
    payload: RenewCertificateRequest,
    db: Session = Depends(get_db),
):
    """Renew an agent mTLS client certificate."""
    res = renew_agent_certificate(
        db=db,
        csr_pem=payload.csr,
        cluster_uuid=payload.cluster_uuid,
        node_name=payload.node_name,
    )
    return RenewCertificateResponse(**res)


@router.get("/ca")
def get_ca():
    """Retrieve Console Root CA certificate bundle."""
    return {"ca_certificate": get_ca_bundle_pem()}


@router.post(
    "/agent-heartbeat",
    response_model=dict[str, Any],
)
@handle_route_errors("agent heartbeat ping")
def agent_heartbeat(
    payload: AgentHeartbeatRequest,
    db: Session = Depends(get_db),
):
    """Receive live heartbeat from forge-agent, updating cluster & operator push connectivity."""
    provider = ClusterDataProvider(db)
    return provider.record_agent_heartbeat(
        cluster_ident=payload.cluster_id,
        node_name=payload.node_name,
        agent_id=payload.agent_id,
        status=payload.status,
        uptime_seconds=payload.uptime_seconds,
    )


@router.get(
    "/status/{cluster_id}",
    response_model=AgentStatusResponse,
    dependencies=[Depends(require_viewer)],
)
@handle_route_errors("get cluster agent status")
def get_cluster_agent_status(
    cluster_id: str,
    db: Session = Depends(get_db),
):
    """Inspect current agent push connectivity status and last heartbeat timestamp for a cluster."""
    provider = ClusterDataProvider(db)
    cluster = provider.resolve_cluster(cluster_id)
    has_agent = provider.has_active_agent(cluster)
    operator = (
        db.query(ConnectedOperator)
        .filter(ConnectedOperator.cluster_id == cluster.id)
        .first()
    )

    return AgentStatusResponse(
        cluster_id=cluster.id,
        cluster_name=cluster.name,
        has_active_agent=has_agent,
        connection_mode="AGENT_PUSH" if has_agent else "DIRECT_KUBECONFIG",
        status=cluster.status,
        connectivity_status=cluster.connectivity_status,
        last_heartbeat_at=operator.last_heartbeat_at.isoformat() if operator and operator.last_heartbeat_at else None,
        uptime_seconds=operator.uptime_seconds if operator else 0,
    )

