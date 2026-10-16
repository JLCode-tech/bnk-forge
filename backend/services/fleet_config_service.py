"""
Fleet Config Service — manage and deploy reusable Kubernetes configs across fleet clusters.
"""

import logging

import yaml
from sqlalchemy.orm import Session

from core.errors import BadRequestError, NotFoundError
from models.fleet_config import FleetDeployableConfig
from models.kubernetes import KubernetesCluster
from schemas.fleet_config import (
    ClusterDeployResult,
    ClusterResourceResult,
    DeployFleetConfigResponse,
)
from services.kubernetes_service import KubernetesService

logger = logging.getLogger(__name__)


def list_deployable_configs(
    db: Session,
    fleet_id: int | None = None,
    category: str | None = None,
) -> list[FleetDeployableConfig]:
    """List fleet deployable configs.

    If fleet_id is provided, returns configs for that fleet as well as global configs (fleet_id is None).
    """
    try:
        query = db.query(FleetDeployableConfig)
        if fleet_id is not None:
            query = query.filter(
                (FleetDeployableConfig.fleet_id == fleet_id) | (FleetDeployableConfig.fleet_id.is_(None))
            )
        if category:
            query = query.filter(FleetDeployableConfig.category == category)
        return query.order_by(FleetDeployableConfig.updated_at.desc()).all()
    except Exception as exc:
        logger.warning("Failed to list deployable configs: %s", exc)
        return []


def get_deployable_config(db: Session, config_id: int) -> FleetDeployableConfig:
    """Get a single deployable config by ID."""
    try:
        config = db.query(FleetDeployableConfig).filter(FleetDeployableConfig.id == config_id).first()
    except Exception as exc:
        logger.warning("Failed to get deployable config %s: %s", config_id, exc)
        raise NotFoundError("FleetDeployableConfig", str(config_id))
    if not config:
        raise NotFoundError("FleetDeployableConfig", str(config_id))
    return config


def create_deployable_config(
    db: Session,
    name: str,
    config_yaml: str,
    description: str | None = None,
    category: str = "custom",
    target_namespace: str | None = None,
    fleet_id: int | None = None,
    source_cluster_id: int | None = None,
    source_cluster_name: str | None = None,
    created_by: str | None = None,
) -> FleetDeployableConfig:
    """Create and validate a new deployable config."""
    if not name or not name.strip():
        raise BadRequestError("Config name is required", code="INVALID_NAME")
    if not config_yaml or not config_yaml.strip():
        raise BadRequestError("Config YAML cannot be empty", code="EMPTY_YAML")

    # Validate that it is valid YAML
    try:
        list(yaml.safe_load_all(config_yaml))
    except Exception as e:
        raise BadRequestError(f"Invalid YAML format: {e}", code="INVALID_YAML")

    config = FleetDeployableConfig(
        fleet_id=fleet_id,
        name=name.strip(),
        description=description.strip() if description else None,
        category=category or "custom",
        target_namespace=target_namespace.strip() if target_namespace else None,
        config_yaml=config_yaml.strip(),
        source_cluster_id=source_cluster_id,
        source_cluster_name=source_cluster_name,
        created_by=created_by,
    )
    db.add(config)
    db.commit()
    db.refresh(config)
    return config


def update_deployable_config(
    db: Session,
    config_id: int,
    name: str | None = None,
    description: str | None = None,
    category: str | None = None,
    target_namespace: str | None = None,
    config_yaml: str | None = None,
    fleet_id: int | None = None,
) -> FleetDeployableConfig:
    """Update an existing deployable config."""
    config = get_deployable_config(db, config_id)

    if name is not None:
        if not name.strip():
            raise BadRequestError("Config name cannot be empty", code="INVALID_NAME")
        config.name = name.strip()
    if description is not None:
        config.description = description.strip() if description else None
    if category is not None:
        config.category = category
    if target_namespace is not None:
        config.target_namespace = target_namespace.strip() if target_namespace else None
    if config_yaml is not None:
        if not config_yaml.strip():
            raise BadRequestError("Config YAML cannot be empty", code="EMPTY_YAML")
        try:
            list(yaml.safe_load_all(config_yaml))
        except Exception as e:
            raise BadRequestError(f"Invalid YAML format: {e}", code="INVALID_YAML")
        config.config_yaml = config_yaml.strip()
    if fleet_id is not None:
        config.fleet_id = fleet_id

    db.commit()
    db.refresh(config)
    return config


def delete_deployable_config(db: Session, config_id: int) -> None:
    """Delete a deployable config."""
    config = get_deployable_config(db, config_id)
    db.delete(config)
    db.commit()


def deploy_or_validate_fleet_config(
    db: Session,
    target_cluster_ids: list[int],
    config_yaml: str | None = None,
    config_id: int | None = None,
    target_namespace: str | None = None,
    dry_run: bool = True,
) -> DeployFleetConfigResponse:
    """
    Validate (dry_run=True) or deploy (dry_run=False) YAML across multiple clusters.

    Uses Kubernetes server-side apply (PATCH application/apply-patch+yaml) with
    field_manager='bnk-forge' and force=True.
    When dry_run=True, dry_run='All' is passed to verify CRD presence and schema validation.
    """
    from kubernetes import client as k8s_client
    from kubernetes.client.rest import ApiException

    from services.execution.kubernetes_engine import KNOWN_PLURALS
    from services.kubernetes._resources import resolve_plural_by_kind

    if not target_cluster_ids:
        raise BadRequestError("At least one target cluster must be selected", code="NO_CLUSTERS")

    yaml_content = config_yaml
    target_ns = target_namespace

    if not yaml_content and config_id is not None:
        saved_cfg = get_deployable_config(db, config_id)
        yaml_content = saved_cfg.config_yaml
        if not target_ns:
            target_ns = saved_cfg.target_namespace

    if not yaml_content or not yaml_content.strip():
        if config_id is not None:
            raise BadRequestError("Config YAML cannot be empty", code="EMPTY_CONFIG")
        raise BadRequestError("Either config_id or config_yaml must be provided", code="MISSING_CONFIG")

    try:
        documents = [d for d in yaml.safe_load_all(yaml_content) if d and isinstance(d, dict)]
    except Exception as e:
        raise BadRequestError(f"Invalid YAML manifest: {e}", code="INVALID_YAML")

    if not documents:
        raise BadRequestError("No valid Kubernetes resources found in YAML", code="NO_RESOURCES")

    clusters = db.query(KubernetesCluster).filter(KubernetesCluster.id.in_(target_cluster_ids)).all()
    cluster_by_id = {c.id: c for c in clusters}

    cluster_results: list[ClusterDeployResult] = []
    k8s_svc = KubernetesService(db)

    for cluster_id_item in target_cluster_ids:
        cluster = cluster_by_id.get(cluster_id_item)
        if not cluster:
            cluster_results.append(
                ClusterDeployResult(
                    cluster_id=cluster_id_item,
                    cluster_name=f"Cluster #{cluster_id_item}",
                    success=False,
                    status="error",
                    message="Cluster not found in database",
                    resources=[],
                )
            )
            continue

        try:
            api_client = k8s_svc.load_kubeconfig(cluster)
            custom_api = k8s_client.CustomObjectsApi(api_client)
        except Exception as e:
            cluster_results.append(
                ClusterDeployResult(
                    cluster_id=cluster.id,
                    cluster_name=cluster.name,
                    success=False,
                    status="error",
                    message=f"Failed to connect to cluster: {str(e)[:200]}",
                    resources=[],
                )
            )
            continue

        cluster_resources_result: list[ClusterResourceResult] = []
        cluster_success = True
        cluster_errors: list[str] = []

        for doc in documents:
            kind = doc.get("kind", "Unknown")
            api_version = doc.get("apiVersion", "v1")
            metadata = doc.get("metadata", {})
            name = metadata.get("name", "unknown")
            ns = metadata.get("namespace") or target_ns or cluster.default_namespace or "default"

            # Parse group and version
            if "/" in api_version:
                group, version = api_version.rsplit("/", 1)
            else:
                group, version = "", api_version

            plural = resolve_plural_by_kind(db, cluster.id, kind, group or None) or KNOWN_PLURALS.get(
                kind, kind.lower() + "s"
            )

            dry_run_val = "All" if dry_run else None

            try:
                # If non-core API, apply via CustomObjectsApi
                if group:
                    if ns:
                        # Ensure namespace in doc
                        doc_copy = dict(doc)
                        if "metadata" not in doc_copy:
                            doc_copy["metadata"] = {}
                        doc_copy["metadata"]["namespace"] = ns

                        custom_api.patch_namespaced_custom_object(
                            group=group,
                            version=version,
                            namespace=ns,
                            plural=plural,
                            name=name,
                            body=doc_copy,
                            field_manager="bnk-forge",
                            force=True,
                            dry_run=dry_run_val,
                        )
                    else:
                        custom_api.patch_cluster_custom_object(
                            group=group,
                            version=version,
                            plural=plural,
                            name=name,
                            body=doc,
                            field_manager="bnk-forge",
                            force=True,
                            dry_run=dry_run_val,
                        )
                else:
                    # Core API resource (e.g. ConfigMap, Secret, Service)
                    # Check/apply using typed API or create_resource dry-run
                    doc_yaml = yaml.dump(doc)
                    if dry_run:
                        k8s_svc.create_resource(
                            cluster_id=cluster.id,
                            resource_type_key=kind.lower(),
                            resource_yaml=doc_yaml,
                            namespace=ns,
                            dry_run=True,
                        )
                    else:
                        try:
                            k8s_svc.update_resource(
                                cluster_id=cluster.id,
                                resource_type_key=kind.lower(),
                                resource_name=name,
                                resource_yaml=doc_yaml,
                                namespace=ns,
                                dry_run=False,
                            )
                        except Exception:
                            k8s_svc.create_resource(
                                cluster_id=cluster.id,
                                resource_type_key=kind.lower(),
                                resource_yaml=doc_yaml,
                                namespace=ns,
                                dry_run=False,
                            )

                cluster_resources_result.append(
                    ClusterResourceResult(
                        kind=kind,
                        name=name,
                        namespace=ns,
                        status="valid" if dry_run else "applied",
                    )
                )
            except ApiException as e:
                cluster_success = False
                err_msg = str(e.reason or e.body)[:200]
                if e.status == 404:
                    err_msg = f"CRD or resource type '{kind}' ({api_version}) not installed on cluster"
                cluster_errors.append(f"{kind}/{name}: {err_msg}")
                cluster_resources_result.append(
                    ClusterResourceResult(
                        kind=kind,
                        name=name,
                        namespace=ns,
                        status="error",
                        error=err_msg,
                    )
                )
            except Exception as e:
                cluster_success = False
                err_msg = str(e)[:200]
                cluster_errors.append(f"{kind}/{name}: {err_msg}")
                cluster_resources_result.append(
                    ClusterResourceResult(
                        kind=kind,
                        name=name,
                        namespace=ns,
                        status="error",
                        error=err_msg,
                    )
                )

        status_str = (
            ("ready" if cluster_success else "error") if dry_run else ("applied" if cluster_success else "failed")
        )
        msg = (
            f"{'Checked' if dry_run else 'Deployed'} {len(cluster_resources_result)} resource(s) successfully"
            if cluster_success
            else f"Failed: {'; '.join(cluster_errors)}"
        )

        cluster_results.append(
            ClusterDeployResult(
                cluster_id=cluster.id,
                cluster_name=cluster.name,
                success=cluster_success,
                status=status_str,
                message=msg,
                resources=cluster_resources_result,
            )
        )

    successful_count = sum(1 for c in cluster_results if c.success)
    failed_count = len(cluster_results) - successful_count

    return DeployFleetConfigResponse(
        config_id=str(config_id) if config_id is not None else None,
        dry_run=dry_run,
        total_clusters=len(cluster_results),
        successful_clusters=successful_count,
        failed_clusters=failed_count,
        results=cluster_results,
        cluster_results=cluster_results,
    )
