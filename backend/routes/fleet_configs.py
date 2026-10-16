"""
Fleet Deployable Configs API.

Allows creating, saving, dry-run checking, and deploying reusable Kubernetes configurations
across multiple clusters in a fleet.
"""

import logging

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from core.errors import handle_route_errors
from database import get_db
from models.system import User
from routes.auth import require_operator, require_viewer

try:
    from schemas.fleet_config import (
        ConfigOut,
        CreateConfigRequest,
        DeployConfigRequest,
        DeployFleetConfigResponse,
        UpdateConfigRequest,
    )
except ImportError:
    from backend.schemas.fleet_config import (
        ConfigOut,
        CreateConfigRequest,
        DeployConfigRequest,
        DeployFleetConfigResponse,
        UpdateConfigRequest,
    )
from services.fleet_config_service import (
    create_deployable_config,
    delete_deployable_config,
    deploy_or_validate_fleet_config,
    get_deployable_config,
    list_deployable_configs,
    update_deployable_config,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/fleet/configs", tags=["fleet-configs"])


@router.get("", response_model=list[ConfigOut], dependencies=[Depends(require_viewer)])
@handle_route_errors("list fleet deployable configs")
def list_configs(
    fleet_id: int | None = Query(default=None),
    category: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> list[ConfigOut]:
    """List saved deployable configs for a fleet (or all)."""
    configs = list_deployable_configs(db, fleet_id=fleet_id, category=category)
    return [ConfigOut.model_validate(c) for c in configs]


@router.post("", response_model=ConfigOut, status_code=201)
@handle_route_errors("create fleet deployable config")
def create_config(
    body: CreateConfigRequest,
    current_user: User = Depends(require_operator),
    db: Session = Depends(get_db),
) -> ConfigOut:
    """Save a new fleet deployable config."""
    config = create_deployable_config(
        db=db,
        name=body.name,
        config_yaml=body.config_yaml,
        description=body.description,
        category=body.category,
        target_namespace=body.target_namespace,
        fleet_id=body.fleet_id,
        source_cluster_id=body.source_cluster_id,
        source_cluster_name=body.source_cluster_name,
        created_by=current_user.username,
    )
    return ConfigOut.model_validate(config)


@router.get("/{config_id}", response_model=ConfigOut, dependencies=[Depends(require_viewer)])
@handle_route_errors("get fleet deployable config")
def get_config(
    config_id: int,
    db: Session = Depends(get_db),
) -> ConfigOut:
    """Get a single fleet deployable config by ID."""
    config = get_deployable_config(db, config_id)
    return ConfigOut.model_validate(config)


@router.put("/{config_id}", response_model=ConfigOut)
@handle_route_errors("update fleet deployable config")
def update_config(
    config_id: int,
    body: UpdateConfigRequest,
    current_user: User = Depends(require_operator),
    db: Session = Depends(get_db),
) -> ConfigOut:
    """Update a fleet deployable config."""
    config = update_deployable_config(
        db=db,
        config_id=config_id,
        name=body.name,
        description=body.description,
        category=body.category,
        target_namespace=body.target_namespace,
        config_yaml=body.config_yaml,
        fleet_id=body.fleet_id,
    )
    return ConfigOut.model_validate(config)


@router.delete("/{config_id}", status_code=204)
@handle_route_errors("delete fleet deployable config")
def delete_config(
    config_id: int,
    current_user: User = Depends(require_operator),
    db: Session = Depends(get_db),
) -> None:
    """Delete a fleet deployable config."""
    delete_deployable_config(db, config_id)


@router.post("/deploy", response_model=DeployFleetConfigResponse)
@handle_route_errors("deploy or check fleet config")
def deploy_config_to_fleet(
    body: DeployConfigRequest,
    current_user: User = Depends(require_operator),
    db: Session = Depends(get_db),
) -> DeployFleetConfigResponse:
    """
    Validate (dry_run=True) or deploy (dry_run=False) a config across multiple clusters.

    Either `config_id` or `config_yaml` must be provided.
    """
    return deploy_or_validate_fleet_config(
        db=db,
        target_cluster_ids=body.target_cluster_ids,
        config_yaml=body.config_yaml,
        config_id=body.config_id,
        target_namespace=body.target_namespace,
        dry_run=body.dry_run,
    )
