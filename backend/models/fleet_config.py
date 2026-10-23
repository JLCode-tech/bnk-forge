"""FleetDeployableConfig model — reusable config templates deployable across fleet clusters."""

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from database import Base


class FleetDeployableConfig(Base):
    """
    FleetDeployableConfig represents a reusable Kubernetes configuration/manifest
    (Gateway API, BNK Security Policy, HTTPRoute, CRD, or custom YAML) that can
    be validated (dry-run) and deployed across multiple clusters in a fleet.
    """

    __tablename__ = "fleet_deployable_configs"

    id = Column(Integer, primary_key=True, index=True)
    fleet_id = Column(Integer, ForeignKey("fleet_targets.id", ondelete="SET NULL"), nullable=True, index=True)
    name = Column(String(255), nullable=False)
    description = Column(String(1000), nullable=True)
    category = Column(String(100), nullable=False, default="custom")  # routing, security, gateway, crd, custom
    target_namespace = Column(String(255), nullable=True)
    config_yaml = Column(Text, nullable=False)
    source_cluster_id = Column(Integer, ForeignKey("kubernetes_clusters.id", ondelete="SET NULL"), nullable=True)
    source_cluster_name = Column(String(255), nullable=True)
    created_by = Column(String(255), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    fleet = relationship("FleetTarget", foreign_keys=[fleet_id])
    source_cluster = relationship("KubernetesCluster", foreign_keys=[source_cluster_id])
