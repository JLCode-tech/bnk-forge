"""
Fleet Agent Enrollment and Bootstrap Service.
Mints short-lived (24h) enrollment JWTs, processes agent CSR handshakes,
issues mTLS client certs with SPIFFE identities, and renders deployment manifests.
"""

import hashlib
import logging
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from jose import JWTError, jwt
from sqlalchemy.orm import Session

from core.config import settings
from core.errors import BadRequestError, NotFoundError, UnauthorizedError
from models import User
from models.kubernetes import KubernetesCluster
from models.operator import ConnectedOperator, OperatorRegistrationToken
from services.pki_service import get_ca_bundle_pem, sign_agent_csr

logger = logging.getLogger(__name__)

ENROLLMENT_TOKEN_ALGORITHM = "HS256"
DEFAULT_ENROLLMENT_TTL_HOURS = 24


def mint_enrollment_token(
    db: Session,
    user: User,
    cluster_name: str,
    project_id: int | None = None,
    cluster_id: int | None = None,
    expires_in_hours: int = DEFAULT_ENROLLMENT_TTL_HOURS,
    max_uses: int | None = 1,
    labels: dict[str, Any] | None = None,
) -> tuple[str, OperatorRegistrationToken]:
    """Mint a cryptographically signed 24h JWT enrollment token and persist metadata."""
    if expires_in_hours <= 0:
        expires_in_hours = DEFAULT_ENROLLMENT_TTL_HOURS

    now = datetime.now(UTC)
    expires_at = now + timedelta(hours=expires_in_hours)
    token_jti = str(uuid.uuid4())
    token_entropy = secrets.token_hex(16)
    prefix = f"frg_enr_{token_entropy[:8]}"

    claims = {
        "sub": f"enrollment:{prefix}",
        "jti": token_jti,
        "type": "agent_enrollment",
        "cluster_name": cluster_name,
        "project_id": project_id,
        "cluster_id": cluster_id,
        "created_by": user.username if user else "system",
        "iat": int(now.timestamp()),
        "exp": int(expires_at.timestamp()),
    }

    raw_jwt = jwt.encode(claims, settings.JWT_SECRET_KEY, algorithm=ENROLLMENT_TOKEN_ALGORITHM)
    token_hash = hashlib.sha256(raw_jwt.encode("utf-8")).hexdigest()

    token_labels = labels or {}
    token_labels.update({
        "cluster_name": cluster_name,
        "project_id": project_id,
        "cluster_id": cluster_id,
    })

    token_record = OperatorRegistrationToken(
        name=f"Enrollment token for {cluster_name}",
        token_hash=token_hash,
        token_prefix=prefix,
        max_uses=max_uses,
        use_count=0,
        expires_at=expires_at,
        labels=token_labels,
        is_active=True,
        created_by=user.username if user else "system",
    )

    db.add(token_record)
    db.commit()
    db.refresh(token_record)

    logger.info(
        "Minted enrollment token %s for cluster '%s' (expires in %dh)",
        prefix, cluster_name, expires_in_hours,
    )
    return raw_jwt, token_record


def validate_and_consume_token(
    db: Session,
    raw_token: str,
) -> tuple[dict[str, Any], OperatorRegistrationToken]:
    """Validate enrollment JWT and record token consumption."""
    try:
        claims = jwt.decode(raw_token, settings.JWT_SECRET_KEY, algorithms=[ENROLLMENT_TOKEN_ALGORITHM])
    except JWTError as e:
        raise UnauthorizedError(f"Invalid enrollment token: {e}") from e

    if claims.get("type") != "agent_enrollment":
        raise UnauthorizedError("Provided token is not an agent enrollment token")

    token_hash = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
    token_record = (
        db.query(OperatorRegistrationToken)
        .filter(OperatorRegistrationToken.token_hash == token_hash)
        .first()
    )

    if not token_record:
        raise UnauthorizedError("Enrollment token not found or already revoked")

    if not token_record.is_active or token_record.revoked_at is not None:
        raise UnauthorizedError("Enrollment token has been revoked")

    now = datetime.now(UTC)
    expires_at = token_record.expires_at
    if expires_at:
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=UTC)
        if expires_at < now:
            raise UnauthorizedError("Enrollment token has expired")

    if token_record.max_uses is not None and token_record.use_count >= token_record.max_uses:
        raise UnauthorizedError("Enrollment token has exceeded maximum allowed uses")

    # Increment usage
    token_record.use_count += 1
    token_record.last_used_at = now
    db.commit()

    return claims, token_record


def bootstrap_agent(
    db: Session,
    raw_token: str,
    csr_pem: str,
    cluster_uuid: str | None = None,
    node_name: str = "node-01",
    machine_fingerprint: str | None = None,
) -> dict[str, Any]:
    """Execute the agent bootstrap handshake: validate token, sign CSR, return mTLS credentials."""
    claims, token_record = validate_and_consume_token(db, raw_token)

    cluster_name = claims.get("cluster_name", "enrolled-cluster")
    project_id = claims.get("project_id")
    target_cluster_id = claims.get("cluster_id")

    final_cluster_uuid = cluster_uuid or str(uuid.uuid4())

    try:
        client_cert_pem, cert_expiry = sign_agent_csr(
            csr_pem=csr_pem,
            cluster_uuid=final_cluster_uuid,
            node_name=node_name,
            validity_days=30,
        )
    except Exception as e:
        logger.error("Failed to sign agent CSR: %v", e)
        raise BadRequestError(f"Failed to sign CSR: {e}") from e

    ca_bundle_pem = get_ca_bundle_pem()

    # Link or auto-register cluster in KubernetesCluster table
    cluster_obj: KubernetesCluster | None = None
    if target_cluster_id:
        cluster_obj = db.query(KubernetesCluster).filter(KubernetesCluster.id == target_cluster_id).first()
    elif project_id:
        cluster_obj = (
            db.query(KubernetesCluster)
            .filter(KubernetesCluster.project_id == project_id, KubernetesCluster.name == cluster_name)
            .first()
        )

    if cluster_obj:
        cluster_obj.connectivity_status = "connected"
        cluster_obj.integration_status = "agent_connected"
        cluster_obj.access_method = "agent_push"
        cluster_obj.last_synced_at = datetime.now(UTC)
    else:
        # Create cluster record if not found
        cluster_obj = KubernetesCluster(
            name=cluster_name,
            context=f"forge-agent-{cluster_name}",
            project_id=project_id,
            cloud_provider="k8s-agent",
            status="active",
            connectivity_status="connected",
            integration_status="agent_connected",
            access_method="agent_push",
            last_synced_at=datetime.now(UTC),
            meta_data={"cluster_uuid": final_cluster_uuid, "enrolled_via": "push_agent"},
        )
        db.add(cluster_obj)
        db.flush()

    # Upsert ConnectedOperator entry
    op_id = f"op-{final_cluster_uuid[:12]}"
    operator = db.query(ConnectedOperator).filter(ConnectedOperator.cluster_id == cluster_obj.id).first()
    now_dt = datetime.now(UTC)
    if not operator:
        operator = ConnectedOperator(
            operator_id=op_id,
            registration_token_id=token_record.id,
            cluster_name=cluster_name,
            cluster_id=cluster_obj.id,
            connectivity_mode="mtls_agent",
            is_connected=True,
            last_connected_at=now_dt,
            last_heartbeat_at=now_dt,
            status="active",
            labels=token_record.labels or {},
        )
        db.add(operator)
    else:
        operator.is_connected = True
        operator.last_connected_at = now_dt
        operator.last_heartbeat_at = now_dt
        operator.status = "active"
        operator.connectivity_mode = "mtls_agent"

    db.commit()

    return {
        "status": "enrolled",
        "certificate": client_cert_pem,
        "ca_certificate": ca_bundle_pem,
        "cluster_uuid": final_cluster_uuid,
        "spiffe_id": f"spiffe://forge/cluster/{final_cluster_uuid}",
        "console_url": "https://console:17543",
        "heartbeat_interval_sec": 15,
        "expires_at": cert_expiry.isoformat(),
        "cluster_id": cluster_obj.id,
        "cluster_name": cluster_obj.name,
    }


def renew_agent_certificate(
    db: Session,
    csr_pem: str,
    cluster_uuid: str,
    node_name: str = "node-01",
) -> dict[str, Any]:
    """Renew an agent mTLS client certificate for another 30 days."""
    try:
        client_cert_pem, cert_expiry = sign_agent_csr(
            csr_pem=csr_pem,
            cluster_uuid=cluster_uuid,
            node_name=node_name,
            validity_days=30,
        )
    except Exception as e:
        raise BadRequestError(f"Failed to renew certificate: {e}") from e

    ca_bundle_pem = get_ca_bundle_pem()
    return {
        "status": "renewed",
        "certificate": client_cert_pem,
        "ca_certificate": ca_bundle_pem,
        "cluster_uuid": cluster_uuid,
        "spiffe_id": f"spiffe://forge/cluster/{cluster_uuid}",
        "expires_at": cert_expiry.isoformat(),
    }


def list_enrollment_tokens(
    db: Session,
    project_id: int | None = None,
) -> list[OperatorRegistrationToken]:
    """List active enrollment tokens, optionally filtered by project."""
    query = (
        db.query(OperatorRegistrationToken)
        .filter(OperatorRegistrationToken.is_active.is_(True))
        .order_by(OperatorRegistrationToken.created_at.desc())
    )
    tokens = query.all()
    if project_id is not None:
        return [t for t in tokens if t.labels and t.labels.get("project_id") == project_id]
    return tokens


def revoke_enrollment_token(
    db: Session,
    token_id: int,
    user: User,
) -> OperatorRegistrationToken:
    """Revoke an active enrollment token."""
    token = db.query(OperatorRegistrationToken).filter(OperatorRegistrationToken.id == token_id).first()
    if not token:
        raise NotFoundError(f"Enrollment token {token_id} not found")

    token.is_active = False
    token.revoked_at = datetime.now(UTC)
    token.revoked_by = user.username if user else "system"
    db.commit()
    db.refresh(token)
    return token


def generate_enrollment_manifests(
    raw_token: str,
    cluster_name: str,
    console_url: str = "https://console:17543",
) -> dict[str, str]:
    """Generate ready-to-run Helm and kubectl commands for agent enrollment."""
    helm_cmd = (
        f"helm repo add bnk-forge https://charts.bnkforge.local --force-update && \\\n"
        f"helm upgrade --install forge-agent bnk-forge/forge-agent \\\n"
        f"  --namespace forge-system --create-namespace \\\n"
        f"  --set console.url=\"{console_url}\" \\\n"
        f"  --set enrollment.token=\"{raw_token}\" \\\n"
        f"  --set cluster.name=\"{cluster_name}\""
    )

    kubectl_manifest = f"""apiVersion: v1
kind: Namespace
metadata:
  name: forge-system
---
apiVersion: v1
kind: Secret
metadata:
  name: forge-agent-enrollment
  namespace: forge-system
type: Opaque
stringData:
  enrollment-token: "{raw_token}"
  console-url: "{console_url}"
  cluster-name: "{cluster_name}"
---
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: forge-agent
  namespace: forge-system
  labels:
    app.kubernetes.io/name: forge-agent
spec:
  selector:
    matchLabels:
      app.kubernetes.io/name: forge-agent
  template:
    metadata:
      labels:
        app.kubernetes.io/name: forge-agent
    spec:
      serviceAccountName: forge-agent
      hostNetwork: false
      hostPID: true
      containers:
      - name: forge-agent
        image: registry.internal/forge/forge-agent:v1.0.0-pov
        securityContext:
          privileged: true
          capabilities:
            add: ["SYS_ADMIN", "BPF", "NET_ADMIN"]
        env:
        - name: CONSOLE_URL
          valueFrom:
            secretKeyRef:
              name: forge-agent-enrollment
              key: console-url
        - name: ENROLLMENT_TOKEN
          valueFrom:
            secretKeyRef:
              name: forge-agent-enrollment
              key: enrollment-token
        - name: CLUSTER_NAME
          valueFrom:
            secretKeyRef:
              name: forge-agent-enrollment
              key: cluster-name
        - name: NODE_NAME
          valueFrom:
            fieldRef:
              fieldPath: spec.nodeName
        volumeMounts:
        - name: tmm-socket
          mountPath: /var/run/tmm
          readOnly: true
      volumes:
      - name: tmm-socket
        hostPath:
          path: /var/run/tmm
          type: DirectoryOrCreate
"""

    kubectl_cmd = (
        f"kubectl apply -f - <<'EOF'\n"
        f"{kubectl_manifest}\n"
        f"EOF"
    )

    return {
        "helm_command": helm_cmd,
        "kubectl_command": kubectl_cmd,
        "raw_manifest": kubectl_manifest,
        "cluster_name": cluster_name,
        "console_url": console_url,
    }
