"""Add fleet_deployable_configs table.

Revision ID: v2_162
Revises: v2_161
"""

import sqlalchemy as sa
from alembic import op

revision = "v2_162"
down_revision = "v2_161"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "fleet_deployable_configs",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column(
            "fleet_id", sa.Integer(), sa.ForeignKey("fleet_targets.id", ondelete="SET NULL"), nullable=True, index=True
        ),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.String(1000), nullable=True),
        sa.Column("category", sa.String(100), nullable=False, server_default="custom"),
        sa.Column("target_namespace", sa.String(255), nullable=True),
        sa.Column("config_yaml", sa.Text(), nullable=False),
        sa.Column(
            "source_cluster_id",
            sa.Integer(),
            sa.ForeignKey("kubernetes_clusters.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("source_cluster_name", sa.String(255), nullable=True),
        sa.Column("created_by", sa.String(255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("fleet_deployable_configs")
