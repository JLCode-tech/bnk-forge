"""Seed BNK 2.4.1 GA row into bnk_releases and link bnk_deployable_release.

Revision ID: v2_163
Revises: v2_162
Create Date: 2026-10-26

Idempotently seeds BNK 2.4.1 GA into bnk_releases (flo_version_prefix='2.30',
manifest_version='2.4.1-3.2850.1-0.0.9', flo_version_min='2.30.1',
flo_version_max='3.0.0', min_k8s='1.30', max_k8s='1.35') and links any existing
bnk-2.4 / bnk-2.4.1 bnk_deployable_release rows whose bnk_release_id is NULL.
"""

from datetime import UTC, datetime

import sqlalchemy as sa

from alembic import op

revision = "v2_163"
down_revision = "v2_162"
branch_labels = None
depends_on = None

_SEED_ROW = {
    "ga_label": "BNK 2.4.1 GA",
    "product_line": "BNK",
    "manifest_version": "2.4.1-3.2850.1-0.0.9",
    "flo_version_prefix": "2.30",
    "flo_version_min": "2.30.1",
    "flo_version_max": "3.0.0",
    "min_k8s": "1.30",
    "max_k8s": "1.35",
    "release_date": None,
    "source_type": "clouddocs",
    "source_url": "https://clouddocs.f5.com/bigip-next-for-kubernetes/latest/",
    "notes": ("CloudDocs BNK 2.4.1 GA release notes + verified manifest 2.4.1-3.2850.1-0.0.9 and FLO v2.30.1-0.0.8."),
    "is_active": True,
}


def upgrade() -> None:
    bind = op.get_bind()
    now = datetime.now(UTC)

    rel_id = bind.execute(
        sa.text("SELECT id FROM bnk_releases WHERE ga_label = :ga_label AND product_line = :product_line"),
        {"ga_label": _SEED_ROW["ga_label"], "product_line": _SEED_ROW["product_line"]},
    ).scalar()

    if rel_id is None:
        bind.execute(
            sa.text(
                "INSERT INTO bnk_releases "
                "(ga_label, product_line, manifest_version, flo_version_prefix, "
                "flo_version_min, flo_version_max, min_k8s, max_k8s, release_date, "
                "source_type, source_url, notes, is_active, created_at, updated_at) "
                "VALUES (:ga_label, :product_line, :manifest_version, :flo_version_prefix, "
                ":flo_version_min, :flo_version_max, :min_k8s, :max_k8s, :release_date, "
                ":source_type, :source_url, :notes, :is_active, :created_at, :updated_at)"
            ),
            {**_SEED_ROW, "created_at": now, "updated_at": now},
        )
        rel_id = bind.execute(
            sa.text("SELECT id FROM bnk_releases WHERE ga_label = :ga_label AND product_line = :product_line"),
            {"ga_label": _SEED_ROW["ga_label"], "product_line": _SEED_ROW["product_line"]},
        ).scalar()

    if rel_id is not None:
        bind.execute(
            sa.text(
                "UPDATE bnk_deployable_release "
                "SET bnk_release_id = :rel_id "
                "WHERE name IN ('bnk-2.4', 'bnk-2.4.1') AND bnk_release_id IS NULL"
            ),
            {"rel_id": rel_id},
        )


def downgrade() -> None:
    bind = op.get_bind()
    rel_id = bind.execute(
        sa.text("SELECT id FROM bnk_releases WHERE ga_label = :ga_label AND product_line = :product_line"),
        {"ga_label": _SEED_ROW["ga_label"], "product_line": _SEED_ROW["product_line"]},
    ).scalar()

    if rel_id is not None:
        bind.execute(
            sa.text("UPDATE bnk_deployable_release SET bnk_release_id = NULL WHERE bnk_release_id = :rel_id"),
            {"rel_id": rel_id},
        )
        bind.execute(
            sa.text("DELETE FROM bnk_releases WHERE id = :rel_id"),
            {"rel_id": rel_id},
        )
