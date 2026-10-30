"""
EKS-specific service for auto-registration and kubeconfig generation.

ENG-006: This service retains its own db.commit() calls because it is called
exclusively from Celery tasks (opentofu_tasks.py) which are the outermost callers.
"""

import logging
from typing import Any

import yaml
from sqlalchemy.orm import Session

from core.encryption import encrypt_value
from models import KubernetesCluster, ProjectModule
from services.kubeconfig_normalizer import NormalizationSource, normalize_kubeconfig

logger = logging.getLogger(__name__)

# Required output keys that identify a deployed EKS cluster.
# This list is the single source of truth shared by register_eks_cluster (validation)
# and matches_eks_output_contract (detection) — they must not drift.
_EKS_CONTRACT_REQUIRED_KEYS = (
    "cluster_name",
    "cluster_endpoint",
    "cluster_certificate_authority_data",
    "region",
)


def matches_eks_output_contract(outputs: dict) -> bool:
    """Return True iff *outputs* satisfies the EKS registration contract.

    A module's outputs match the contract when ``cluster_name``,
    ``cluster_endpoint``, ``cluster_certificate_authority_data``, and a region
    indicator (``region``, ``aws_region``, ``eks_cluster_arn``, or ``cluster_arn``)
    are present with non-empty values.

    Args:
        outputs: Module output dict (may be None or empty — both return False).

    Returns:
        True if the outputs identify a deployable EKS cluster; False otherwise.
    """
    if not outputs or not isinstance(outputs, dict):
        return False
    has_core = all(
        bool(_out_val(outputs, key))
        for key in ("cluster_name", "cluster_endpoint", "cluster_certificate_authority_data")
    )
    has_region = any(
        bool(_out_val(outputs, key)) for key in ("region", "aws_region", "eks_cluster_arn", "cluster_arn", "cluster_id")
    )
    return has_core and has_region


def generate_eks_kubeconfig(
    cluster_name: str, cluster_endpoint: str, cluster_ca_data: str, region: str, context_name: str = None
) -> str:
    """
    Generate a kubeconfig YAML for an EKS cluster.

    Uses aws eks get-token for authentication (exec plugin).
    This requires AWS CLI credentials to be configured.

    Args:
        cluster_name: EKS cluster name
        cluster_endpoint: HTTPS endpoint URL
        cluster_ca_data: Base64-encoded CA certificate
        region: AWS region (e.g., 'ap-southeast-2')
        context_name: Optional context name (defaults to cluster_name)

    Returns:
        YAML string with complete kubeconfig
    """
    if not context_name:
        context_name = cluster_name

    kubeconfig = {
        "apiVersion": "v1",
        "kind": "Config",
        "clusters": [
            {
                "name": cluster_name,
                "cluster": {"server": cluster_endpoint, "certificate-authority-data": cluster_ca_data},
            }
        ],
        "contexts": [{"name": context_name, "context": {"cluster": cluster_name, "user": cluster_name}}],
        "current-context": context_name,
        "users": [
            {
                "name": cluster_name,
                "user": {
                    "exec": {
                        "apiVersion": "client.authentication.k8s.io/v1beta1",
                        "command": "aws",
                        "args": ["eks", "get-token", "--cluster-name", cluster_name, "--region", region],
                    }
                },
            }
        ],
    }

    return yaml.dump(kubeconfig)


def _out_val(outputs: dict[str, Any] | None, key: str) -> Any:
    """Extract a scalar output value from flat or Terraform-wrapped ({'value': ...}) outputs."""
    if not isinstance(outputs, dict):
        return None
    raw = outputs.get(key)
    if isinstance(raw, dict) and "value" in raw:
        return raw["value"]
    return raw


def register_eks_cluster(db: Session, eks_module: ProjectModule) -> KubernetesCluster:
    """
    Auto-register an EKS cluster to the Kubernetes page after deployment.

    Args:
        db: Database session
        eks_module: The deployed EKS ProjectModule with outputs

    Returns:
        The created or updated KubernetesCluster record

    Raises:
        ValueError: If required outputs are missing
    """
    # Extract required outputs
    outputs = eks_module.outputs or {}
    cluster_name = _out_val(outputs, "cluster_name")
    cluster_endpoint = _out_val(outputs, "cluster_endpoint")
    cluster_ca_data = _out_val(outputs, "cluster_certificate_authority_data")

    # Extract region from cluster ARN (most accurate - shows actual deployment location).
    # Support both `cluster_arn` and `eks_cluster_arn` (as well as `cluster_id` when it is an ARN).
    region = None
    raw_arn = (
        _out_val(outputs, "cluster_arn") or _out_val(outputs, "eks_cluster_arn") or _out_val(outputs, "cluster_id")
    )
    if isinstance(raw_arn, str) and raw_arn.startswith("arn:aws:eks:"):
        # ARN format: arn:aws:eks:region:account:cluster/name
        arn_parts = raw_arn.split(":")
        if len(arn_parts) >= 4 and arn_parts[3]:
            region = arn_parts[3]

    # Fallback 1: explicit region output from module
    if not region:
        region = _out_val(outputs, "region") or _out_val(outputs, "aws_region")

    # Fallback 2: use project region or project variable_defaults if ARN/output extraction failed
    if not region and getattr(eks_module, "project", None) is not None:
        region = getattr(eks_module.project, "region", None)
        if not region:
            proj_vars = getattr(eks_module.project, "project_variables", None) or {}
            if isinstance(proj_vars, dict):
                var_defaults = proj_vars.get("variable_defaults") or {}
                if isinstance(var_defaults, dict):
                    region = var_defaults.get("aws_region") or var_defaults.get("region")

    # Validate required outputs
    if not all([cluster_name, cluster_endpoint, cluster_ca_data, region]):
        missing = []
        if not cluster_name:
            missing.append("cluster_name")
        if not cluster_endpoint:
            missing.append("cluster_endpoint")
        if not cluster_ca_data:
            missing.append("cluster_certificate_authority_data")
        if not region:
            missing.append("region")
        raise ValueError(f"Missing required EKS outputs for registration: {', '.join(missing)}")

    # Generate kubeconfig
    logger.info(f"Generating kubeconfig for EKS cluster {cluster_name}")
    kubeconfig_yaml = generate_eks_kubeconfig(
        cluster_name=cluster_name, cluster_endpoint=cluster_endpoint, cluster_ca_data=cluster_ca_data, region=region
    )

    # Assert invariant — EKS kubeconfig builder must produce portable output.
    # Hard-fail on violation (kubeconfig_invariant_violation) so the bug surfaces loudly.
    try:
        kubeconfig_yaml = normalize_kubeconfig(kubeconfig_yaml, source=NormalizationSource.CLOUD_API_GENERATED)
    except Exception as norm_exc:
        logger.error(
            "kubeconfig_invariant_violation: EKS kubeconfig builder produced non-portable output for cluster %s: %s",
            cluster_name,
            norm_exc,
        )
        raise

    # Encrypt kubeconfig
    logger.info(f"Encrypting kubeconfig for cluster {cluster_name}")
    kubeconfig_encrypted = encrypt_value(kubeconfig_yaml)

    resolved_arn = (
        _out_val(outputs, "cluster_arn") or _out_val(outputs, "eks_cluster_arn") or _out_val(outputs, "cluster_id")
    )
    cluster_version = _out_val(outputs, "cluster_version") or _out_val(outputs, "eks_cluster_version")
    oidc_provider_url = _out_val(outputs, "oidc_provider_url") or _out_val(outputs, "cluster_oidc_issuer_url")
    meta_payload = {
        "auto_registered": True,
        "source_module_id": eks_module.id,
        "cluster_arn": resolved_arn,
        "oidc_provider_url": oidc_provider_url,
        "nodegroup_name": _out_val(outputs, "nodegroup_name"),
        "nodegroup_status": _out_val(outputs, "nodegroup_status"),
    }

    # Check if cluster already registered by name in this project
    existing = (
        db.query(KubernetesCluster)
        .filter(KubernetesCluster.name == cluster_name, KubernetesCluster.project_id == eks_module.project_id)
        .first()
    )

    project_clusters = db.query(KubernetesCluster).filter(KubernetesCluster.project_id == eks_module.project_id).all()
    if not existing and isinstance(project_clusters, list):
        for candidate in project_clusters:
            cand_meta = getattr(candidate, "meta_data", None)
            if isinstance(cand_meta, dict) and str(cand_meta.get("source_module_id")) == str(eks_module.id):
                existing = candidate
                break

    if existing:
        existing_meta = getattr(existing, "meta_data", None)
        merged_meta = {**(existing_meta if isinstance(existing_meta, dict) else {}), **meta_payload}
        existing.name = cluster_name
        existing.context = cluster_name
        existing.api_server = cluster_endpoint
        if cluster_version:
            existing.version = cluster_version
        existing.status = "active"
        existing.kubeconfig_encrypted = kubeconfig_encrypted
        existing.cloud_provider = "aws"
        existing.region = region
        existing.meta_data = merged_meta
        cluster = existing
        logger.info(f"Updated existing EKS cluster {cluster_name} (id={cluster.id}) with fresh endpoint and kubeconfig")
    else:
        cluster = KubernetesCluster(
            name=cluster_name,
            context=cluster_name,  # Use cluster name as context
            api_server=cluster_endpoint,
            version=cluster_version,
            status="active",
            project_id=eks_module.project_id,
            kubeconfig_encrypted=kubeconfig_encrypted,
            cloud_provider="aws",
            region=region,
            default_namespace="default",
            meta_data=meta_payload,
        )
        db.add(cluster)

    # Remove any other stale auto-registered EKS cluster rows in the same project
    if isinstance(project_clusters, list):
        for other in project_clusters:
            if other is cluster or (
                getattr(other, "id", None) is not None and getattr(other, "id", None) == getattr(cluster, "id", None)
            ):
                continue
            other_meta = getattr(other, "meta_data", None)
            is_stale_auto_eks = isinstance(other_meta, dict) and (
                str(other_meta.get("source_module_id")) == str(eks_module.id)
                or (
                    other_meta.get("auto_registered") is True
                    and getattr(other, "cloud_provider", None) in ("aws", "eks")
                )
            )
            if is_stale_auto_eks:
                logger.info(
                    f"Removing stale auto-registered EKS cluster record {other.name} (id={other.id}) "
                    f"superseded by {cluster_name}"
                )
                db.delete(other)

    db.commit()
    db.refresh(cluster)

    logger.info(f"Successfully registered EKS cluster {cluster_name} (id={cluster.id}) to Kubernetes page")
    return cluster


def unregister_eks_cluster(db: Session, eks_module: ProjectModule, outputs: dict[str, Any] | None = None) -> bool:
    """
    Remove an EKS cluster from the Kubernetes page when module is destroyed.

    Args:
        db: Database session
        eks_module: The EKS ProjectModule being destroyed
        outputs: Optional snapshot of module outputs captured before clearing

    Returns:
        True if cluster was removed, False if not found
    """
    cluster = None
    effective_outputs = outputs if isinstance(outputs, dict) else (getattr(eks_module, "outputs", None) or {})
    target_name = _out_val(effective_outputs, "cluster_name")

    query = db.query(KubernetesCluster).filter(KubernetesCluster.project_id == eks_module.project_id)
    candidates = query.all()
    if isinstance(candidates, list):
        for cand in candidates:
            cand_meta = getattr(cand, "meta_data", None)
            if isinstance(cand_meta, dict) and str(cand_meta.get("source_module_id")) == str(eks_module.id):
                cluster = cand
                break
        if not cluster and target_name:
            for cand in candidates:
                if cand.name == target_name:
                    cluster = cand
                    break
        if not cluster:
            for cand in candidates:
                cand_meta = getattr(cand, "meta_data", None)
                if (
                    isinstance(cand_meta, dict)
                    and cand_meta.get("auto_registered") is True
                    and getattr(cand, "cloud_provider", None) in ("aws", "eks")
                ):
                    cluster = cand
                    break
    else:
        cluster = query.first()

    if cluster:
        cluster_name = cluster.name
        db.delete(cluster)
        db.commit()
        logger.info(f"Unregistered EKS cluster {cluster_name} (id={cluster.id}) from Kubernetes page")
        return True

    logger.info(f"No registered cluster found for module {eks_module.id}")
    return False


# ---------------------------------------------------------------------------
# Credential-template-driven discovery
# ---------------------------------------------------------------------------


def _boto3_session_from_template(template) -> Any:
    """Build a boto3 Session from a CloudCredentialTemplate.

    Reuses the same credential-resolution rules as CredentialTemplateService
    so credential-template discovery never duplicates auth logic.
    """
    import boto3

    if template.aws_auth_method == "access_keys":
        from core.encryption import decrypt_value

        secret_key = (
            decrypt_value(template.aws_secret_access_key_encrypted)
            if template.aws_secret_access_key_encrypted
            else None
        )
        session_token = (
            decrypt_value(template.aws_session_token_encrypted) if template.aws_session_token_encrypted else None
        )
        return boto3.Session(
            aws_access_key_id=template.aws_access_key_id,
            aws_secret_access_key=secret_key,
            aws_session_token=session_token,
            region_name=template.region or None,
        )

    if template.aws_auth_method == "profile":
        from services.credentials_service import attach_aws_cli_credential_cache

        session = boto3.Session(profile_name=template.aws_profile, region_name=template.region or None)
        attach_aws_cli_credential_cache(session)
        return session

    # SSO / default session — picks up whatever the SSO flow already populated.
    return boto3.Session(region_name=template.region or None)


def list_eks_clusters_from_template(template) -> list[dict[str, Any]]:
    """List EKS clusters reachable via *template* credentials.

    Returns a list of cluster info dicts with the keys required by
    ``generate_eks_kubeconfig`` plus metadata for registration.
    """
    from botocore.exceptions import BotoCoreError, ClientError

    from core.aws_config import adaptive_retry_config

    session = _boto3_session_from_template(template)
    region = template.region or session.region_name
    if not region:
        raise ValueError("AWS region is required to list EKS clusters")

    try:
        eks = session.client("eks", region_name=region, config=adaptive_retry_config())
        response = eks.list_clusters()
        cluster_names = response.get("clusters", [])
    except (ClientError, BotoCoreError) as e:
        raise RuntimeError(f"Failed to list EKS clusters in {region}: {e}") from e

    clusters = []
    for name in cluster_names:
        try:
            detail = eks.describe_cluster(name=name)["cluster"]
        except (ClientError, BotoCoreError) as e:
            logger.warning(f"Skipping EKS cluster {name}: describe_cluster failed: {e}")
            continue

        endpoint = detail.get("endpoint")
        ca_data = detail.get("certificateAuthority", {}).get("data")
        if not endpoint or not ca_data:
            logger.warning(f"Skipping EKS cluster {name}: missing endpoint or CA data")
            continue

        clusters.append(
            {
                "name": name,
                "endpoint": endpoint,
                "certificate_authority_data": ca_data,
                "region": region,
                "version": detail.get("version"),
                "arn": detail.get("arn"),
                "account_id": detail.get("arn", "").split(":")[4] if detail.get("arn") else None,
            }
        )

    return clusters
