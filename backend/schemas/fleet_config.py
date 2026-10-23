"""
Fleet Deployable Configs Pydantic schemas.

Strict DTO boundary definitions for fleet config operations.
"""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_serializer, model_validator


class ConfigOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    fleet_id: int | None = None
    name: str
    description: str | None = None
    category: str = "custom"
    target_namespace: str | None = None
    config_yaml: str
    source_cluster_id: int | None = None
    source_cluster_name: str | None = None
    created_by: str | None = None
    created_at: datetime | str | None = None
    updated_at: datetime | str | None = None

    @field_serializer("created_at", "updated_at", when_used="json")
    def serialize_datetime(self, value: datetime | str | None) -> str | None:
        if isinstance(value, datetime):
            return value.isoformat()
        return value


class CreateConfigRequest(BaseModel):
    name: str
    config_yaml: str
    description: str | None = None
    category: str = "custom"
    target_namespace: str | None = None
    fleet_id: int | None = None
    source_cluster_id: int | None = None
    source_cluster_name: str | None = None


class UpdateConfigRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    category: str | None = None
    target_namespace: str | None = None
    config_yaml: str | None = None
    fleet_id: int | None = None


class DeployConfigRequest(BaseModel):
    target_cluster_ids: list[int]
    config_yaml: str | None = None
    config_id: int | None = None
    target_namespace: str | None = None
    dry_run: bool = True


class ClusterResourceResult(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    kind: str
    name: str
    namespace: str | None = None
    status: str
    error: str | None = None


class ClusterDeployResult(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    cluster_id: int | str
    cluster_name: str
    success: bool
    status: str | None = None
    message: str | None = None
    resources: list[ClusterResourceResult] = Field(default_factory=list)
    error: str | None = None


class DeployFleetConfigResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    config_id: str | int | None = None
    dry_run: bool
    total_clusters: int
    successful_clusters: int
    failed_clusters: int = 0
    results: list[ClusterDeployResult] = Field(default_factory=list)
    cluster_results: list[ClusterDeployResult] = Field(default_factory=list)

    @model_validator(mode="before")
    @classmethod
    def sync_results(cls, data: Any) -> Any:
        if isinstance(data, dict):
            if "results" in data and "cluster_results" not in data:
                data["cluster_results"] = data["results"]
            elif "cluster_results" in data and "results" not in data:
                data["results"] = data["cluster_results"]
        return data
