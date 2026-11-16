#!/usr/bin/env python3
"""
BNK Forge Idempotent Seed Runner
Part of BNK Forge PoV Migration (Milestone 1).

Executes all initial system and catalog seeds idempotently.
Can be executed standalone:
    python -m seeds.seed_runner
or imported:
    from seeds.seed_runner import run_all_seeds
"""
import json
import logging
import sys
from datetime import UTC, datetime
from pathlib import Path

# Ensure backend root is in sys.path
_BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from sqlalchemy import create_engine, inspect, text  # noqa: E402

from database import DATABASE_URL  # noqa: E402

logger = logging.getLogger("seed_runner")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")


def seed_alembic_stamp(engine) -> None:
    """Stamp alembic_version with v2_163 if table exists so legacy checks pass."""
    with engine.begin() as conn:
        inspector = inspect(conn)
        if "alembic_version" in inspector.get_table_names():
            row = conn.execute(text("SELECT version_num FROM alembic_version LIMIT 1")).first()
            if row is None:
                conn.execute(text("INSERT INTO alembic_version (version_num) VALUES ('v2_163')"))
                logger.info("   • alembic_version stamped with v2_163")
            else:
                logger.info("   • alembic_version already set to %s", row[0])


def seed_bluefield_images(engine) -> None:
    """Seed default BlueField software images."""
    bfb_filename = "bf-bundle-2.9.2-32_25.02_ubuntu-22.04_prod.bfb"
    bfb_base_url = "https://content.mellanox.com/BlueField/BFBs/Ubuntu22.04"

    with engine.begin() as conn:
        existing = conn.execute(
            text(
                "SELECT id FROM bluefield_software_images "
                "WHERE doca_version = :dv AND host_os = :os AND host_arch = :arch"
            ),
            {"dv": "2.9.2", "os": "ubuntu", "arch": "arm64"},
        ).first()
        if existing is None:
            conn.execute(
                text(
                    "INSERT INTO bluefield_software_images "
                    "(image_filename, base_url, doca_version, doca_package, "
                    " host_os, host_os_version, host_arch, doca_host_url, "
                    " is_default, notes) "
                    "VALUES (:fn, :url, :dv, :dp, :host_os, :host_os_version, :host_arch, :doca_host_url, :d, :notes)"
                ),
                {
                    "fn": bfb_filename,
                    "url": bfb_base_url,
                    "dv": "2.9.2",
                    "dp": "doca-all",
                    "host_os": "ubuntu",
                    "host_os_version": "22.04",
                    "host_arch": "arm64",
                    "doca_host_url": "https://www.mellanox.com/downloads/DOCA/DOCA_v2.9.2/host/doca-host_2.9.2-012101-24.10-ubuntu2204_arm64.deb",
                    "d": True,
                    "notes": "DOCA 2.9.2 LTS — BNK 2.2 tested. Host: doca-all 2.9.2, DPU: bf-bundle 2.9.2",
                },
            )
            logger.info("   • seeded bluefield image: %s", bfb_filename)
        else:
            logger.info("   • bluefield image already present: %s", bfb_filename)


def seed_bf_conf_templates(engine) -> None:
    """Seed initial BlueField configuration templates (LAG and No-LAG)."""
    bf_templates = [
        (
            "Uplinks via LAG (bond0)",
            "bf_template_lag.conf",
            "F5/Nvidia RCP RA with LACP based LAG uplinks",
        ),
        (
            "Uplinks via p0/p1 (no LAG)",
            "bf_template_nolag.conf",
            "VLAN interfaces attached p0 and/or p1 uplinks",
        ),
    ]
    seed_dir = _BACKEND_DIR / "alembic" / "seed_data"

    with engine.begin() as conn:
        for name, filename, description in bf_templates:
            existing = conn.execute(
                text("SELECT id FROM bf_conf_templates WHERE name = :name"),
                {"name": name},
            ).first()
            if existing is not None:
                logger.info("   • bf.conf template already present: %s", name)
                continue
            seed_path = seed_dir / filename
            if not seed_path.is_file():
                logger.warning("   ⚠️  Seed template file missing: %s", seed_path)
                continue
            content = seed_path.read_text(encoding="utf-8")
            conn.execute(
                text(
                    "INSERT INTO bf_conf_templates "
                    "(name, description, content, matching_bnk_version) "
                    "VALUES (:name, :desc, :content, NULL)"
                ),
                {"name": name, "desc": description, "content": content},
            )
            logger.info("   • seeded bf.conf template: %s", name)


def seed_bnk_releases(engine) -> None:
    """Seed canonical BNK Releases matrix."""
    releases = [
        {
            "ga_label": "BNK 2.4.1 GA",
            "product_line": "BNK",
            "manifest_version": "2.4.1-3.2850.1-0.0.9",
            "flo_version_prefix": "2.30",
            "flo_version_min": "2.30.1",
            "flo_version_max": "3.0.0",
            "min_k8s": "1.32",
            "max_k8s": "1.35",
            "release_date": None,
            "source_type": "clouddocs",
            "source_url": "https://clouddocs.f5.com/bigip-next-for-kubernetes/latest/",
            "notes": "CloudDocs BNK 2.4.1 GA release notes + verified manifest 2.4.1-3.2850.1-0.0.9 and FLO v2.30.1-0.0.8.",
            "is_active": True,
        },
        {
            "ga_label": "BNK 2.3 GA",
            "product_line": "BNK",
            "manifest_version": "2.3.0",
            "flo_version_prefix": "2.21",
            "flo_version_min": "2.21.0",
            "flo_version_max": "2.22.0",
            "min_k8s": "1.30",
            "max_k8s": "1.31",
            "release_date": None,
            "source_type": "clouddocs",
            "source_url": "https://clouddocs.f5.com/bigip-next-for-kubernetes/latest/",
            "notes": "IBM-F5 manifest 2.3.0 + live-observed FLO 2.21.13 on a known-2.3 cluster.",
            "is_active": True,
        },
        {
            "ga_label": "BNK 2.2 GA",
            "product_line": "BNK",
            "manifest_version": "2.2",
            "flo_version_prefix": "2.9",
            "flo_version_min": "2.0.0",
            "flo_version_max": "2.20.0",
            "min_k8s": "1.30",
            "max_k8s": "1.30",
            "release_date": None,
            "source_type": "clouddocs",
            "source_url": "https://clouddocs.f5.com/cloud/bigip-next-for-k8s/2.2/",
            "notes": "docs/DPU_DEPLOY_ANALYSIS.md (cites clouddocs BNK 2.2) + live-observed FLO 2.9.27.",
            "is_active": True,
        },
        {
            "ga_label": "BNK 2.1.1",
            "product_line": "BNK",
            "manifest_version": "2.1.1",
            "flo_version_prefix": "1.198",
            "flo_version_min": "1.198.0",
            "flo_version_max": "1.199.0",
            "min_k8s": "1.26",
            "max_k8s": "1.29",
            "release_date": None,
            "source_type": "clouddocs",
            "source_url": "https://clouddocs.f5.com/cloud/bigip-next-for-k8s/2.1/",
            "notes": "docs/DPU_DEPLOY_ANALYSIS.md + existing codebase tests. FLO v1.198.x.",
            "is_active": True,
        },
        {
            "ga_label": "BNK 2.1.0",
            "product_line": "BNK",
            "manifest_version": "2.1.0",
            "flo_version_prefix": "1.198",
            "flo_version_min": "1.198.0",
            "flo_version_max": "1.199.0",
            "min_k8s": "1.26",
            "max_k8s": "1.29",
            "release_date": None,
            "source_type": "clouddocs",
            "source_url": "https://clouddocs.f5.com/cloud/bigip-next-for-k8s/2.1/",
            "notes": "clouddocs BNK 2.1 GA. Shares FLO v1.198.x range with 2.1.1.",
            "is_active": True,
        },
        {
            "ga_label": "BNK 2.0",
            "product_line": "BNK",
            "manifest_version": "2.0.0",
            "flo_version_prefix": "1.197",
            "flo_version_min": "1.0.0",
            "flo_version_max": "1.198.0",
            "min_k8s": "1.25",
            "max_k8s": "1.28",
            "release_date": None,
            "source_type": "clouddocs",
            "source_url": "https://clouddocs.f5.com/cloud/bigip-next-for-k8s/2.0/",
            "notes": "clouddocs 2.0 release notes. FLO v1.197.x / v1.7.8 era.",
            "is_active": True,
        },
    ]

    now = datetime.now(UTC)
    with engine.begin() as conn:
        for r in releases:
            existing = conn.execute(
                text("SELECT id FROM bnk_releases WHERE ga_label = :ga_label AND product_line = :product_line"),
                {"ga_label": r["ga_label"], "product_line": r["product_line"]},
            ).first()
            if existing is None:
                conn.execute(
                    text(
                        "INSERT INTO bnk_releases "
                        "(ga_label, product_line, manifest_version, flo_version_prefix, "
                        " flo_version_min, flo_version_max, min_k8s, max_k8s, release_date, "
                        " source_type, source_url, notes, is_active, created_at, updated_at) "
                        "VALUES (:ga_label, :product_line, :manifest_version, :flo_version_prefix, "
                        " :flo_version_min, :flo_version_max, :min_k8s, :max_k8s, :release_date, "
                        " :source_type, :source_url, :notes, :is_active, :created_at, :updated_at)"
                    ),
                    {**r, "created_at": now, "updated_at": now},
                )
                logger.info("   • seeded bnk_release: %s", r["ga_label"])
            else:
                logger.info("   • bnk_release already present: %s", r["ga_label"])


def seed_bnk_deployable_releases(engine) -> None:
    """Seed deployable release matrix."""
    now = datetime.now(UTC)
    deployable_rows = [
        {
            "name": "bnk-2.1",
            "display_name": "BNK 2.1 (GA)",
            "description": "BNK 2.1 General Availability release",
            "is_default": False,
            "is_active": True,
            "source_type": "manual",
            "bnk_manifest_version": "2.1.0",
            "bnk_cr_kind": "CNEInstance",
            "flo_version": "0.9.23",
            "k8s_version": "1.29.8",
            "doca_version": "2.7.0",
            "containerd_version": "1.7.12",
            "runc_version": "1.1.12",
            "calico_version": "3.28.0",
            "cert_manager_version": "v1.14.5",
            "gateway_api_version": "1.1.0",
            "multus_version": "4.0.2",
            "sriov_version": "1.3.0",
            "storage_class_type": "local-path",
            "storage_provisioner": "rancher.io/local-path",
            "feature_flags": json.dumps({"ipv6": False, "tmm_node_labels": True}),
        },
        {
            "name": "bnk-2.2",
            "display_name": "BNK 2.2 (GA)",
            "description": "BNK 2.2 General Availability release",
            "is_default": True,
            "is_active": True,
            "source_type": "manual",
            "bnk_manifest_version": "2.2.1-3.2226.0-0.0.511",
            "bnk_cr_kind": "CNEInstance",
            "flo_version": "v2.9.27-0.3.4",
            "k8s_version": "1.30.4",
            "doca_version": "2.9.1",
            "containerd_version": "1.7.20",
            "runc_version": "1.1.13",
            "calico_version": "3.28.1",
            "cert_manager_version": "v1.15.3",
            "gateway_api_version": "1.1.0",
            "multus_version": "4.1.0",
            "sriov_version": "1.4.0",
            "storage_class_type": "local-path",
            "storage_provisioner": "rancher.io/local-path",
            "feature_flags": json.dumps({"ipv6": False, "tmm_node_labels": True}),
        },
        {
            "name": "bnk-2.3.1",
            "display_name": "BNK 2.3.1 (GA)",
            "description": "BNK 2.3.1 General Availability release",
            "is_default": False,
            "is_active": True,
            "source_type": "manual",
            "bnk_manifest_version": "2.3.1-3.2598.3-0.0.304",
            "bnk_cr_kind": "CNEInstance",
            "flo_version": "v2.21.13-0.0.53",
            "k8s_version": "1.30.14",
            "doca_version": "3.2.0",
            "containerd_version": "1.7.23",
            "runc_version": "1.2.1",
            "calico_version": "3.28.1",
            "cert_manager_version": "v1.16.2",
            "gateway_api_version": "1.1.0",
            "multus_version": "4.1.0",
            "sriov_version": "1.4.0",
            "storage_class_type": "local-path",
            "storage_provisioner": "rancher.io/local-path",
            "feature_flags": json.dumps({"ipv6": False, "tmm_node_labels": True}),
        },
        {
            "name": "bnk-2.4",
            "display_name": "BNK 2.4 (GA)",
            "description": "BNK 2.4 General Availability release",
            "is_default": False,
            "is_active": True,
            "source_type": "manual",
            "bnk_manifest_version": "2.4.0-3.3175.0+0.0.380",
            "bnk_cr_kind": "CNEInstance",
            "flo_version": "v2.30.0-0.5.2",
            "k8s_version": "1.32.0",
            "doca_version": "3.2.0",
            "containerd_version": "1.7.23",
            "runc_version": "1.2.1",
            "calico_version": "3.28.1",
            "cert_manager_version": "v1.16.2",
            "gateway_api_version": "1.2.0",
            "multus_version": "4.1.0",
            "sriov_version": "1.4.0",
            "storage_class_type": "local-path",
            "storage_provisioner": "rancher.io/local-path",
            "feature_flags": json.dumps({"ipv6": False, "tmm_node_labels": True}),
        },
        {
            "name": "bnk-2.4.1",
            "display_name": "BNK 2.4.1 (GA)",
            "description": "BNK 2.4.1 General Availability release with LLM Gateway, CNE HA, BGP BMP, and Analytics 2.4",
            "is_default": False,
            "is_active": True,
            "source_type": "manual",
            "bnk_manifest_version": "2.4.1-3.2850.1-0.0.9",
            "bnk_cr_kind": "CNEInstance",
            "flo_version": "v2.30.1-0.0.8",
            "k8s_version": "1.35.0",
            "doca_version": "3.2.0",
            "containerd_version": "1.7.23",
            "runc_version": "1.2.1",
            "calico_version": "3.28.1",
            "cert_manager_version": "v1.16.2",
            "gateway_api_version": "1.2.0",
            "multus_version": "4.1.0",
            "sriov_version": "1.4.0",
            "storage_class_type": "local-path",
            "storage_provisioner": "rancher.io/local-path",
            "feature_flags": json.dumps(
                {
                    "ipv6": True,
                    "tmm_node_labels": True,
                    "infra_crd": True,
                    "gateway_settings": True,
                    "egress_gateway": True,
                    "epp_ai": True,
                    "agentic_mcp": True,
                    "gaie_inference": True,
                    "observer_telemetry": True,
                    "llm_gateway": True,
                    "cne_ha": True,
                    "bgp_bmp": True,
                    "pseudocni_dpu": True,
                    "analytics_24": True,
                }
            ),
        },
    ]

    with engine.begin() as conn:
        rel_241_id = conn.execute(
            text("SELECT id FROM bnk_releases WHERE ga_label = 'BNK 2.4.1 GA'")
        ).scalar()

        for d in deployable_rows:
            existing = conn.execute(
                text("SELECT id FROM bnk_deployable_release WHERE name = :name"),
                {"name": d["name"]},
            ).first()
            if existing is None:
                release_id = rel_241_id if d["name"] in ("bnk-2.4", "bnk-2.4.1") else None
                conn.execute(
                    text(
                        "INSERT INTO bnk_deployable_release "
                        "(name, display_name, description, is_default, is_active, source_type, bnk_release_id, "
                        " bnk_manifest_version, bnk_cr_kind, flo_version, k8s_version, doca_version, "
                        " containerd_version, runc_version, calico_version, cert_manager_version, "
                        " gateway_api_version, multus_version, sriov_version, "
                        " storage_class_type, storage_provisioner, feature_flags, "
                        " created_at, updated_at) "
                        "VALUES (:name, :display_name, :description, :is_default, :is_active, :source_type, :bnk_release_id, "
                        " :bnk_manifest_version, :bnk_cr_kind, :flo_version, :k8s_version, :doca_version, "
                        " :containerd_version, :runc_version, :calico_version, :cert_manager_version, "
                        " :gateway_api_version, :multus_version, :sriov_version, "
                        " :storage_class_type, :storage_provisioner, :feature_flags, "
                        " :created_at, :updated_at)"
                    ),
                    {**d, "bnk_release_id": release_id, "created_at": now, "updated_at": now},
                )
                logger.info("   • seeded bnk_deployable_release: %s", d["name"])
            else:
                logger.info("   • bnk_deployable_release already present: %s", d["name"])


def seed_core_app_defaults() -> None:
    """Execute high-level startup seeds (defaults, templates, modules, auth)."""
    try:
        from startup_steps import (
            seed_auth_step,
            seed_cli_bnkctl_modules_step,
            seed_defaults_step,
            seed_k8s_builtin_modules_step,
            seed_python_modules_step,
            seed_stack_templates_step,
        )

        logger.info("   • running startup seed_defaults_step...")
        seed_defaults_step()
        logger.info("   • running startup seed_stack_templates_step...")
        seed_stack_templates_step()
        logger.info("   • running startup seed_python_modules_step...")
        seed_python_modules_step()
        logger.info("   • running startup seed_k8s_builtin_modules_step...")
        seed_k8s_builtin_modules_step()
        logger.info("   • running startup seed_cli_bnkctl_modules_step...")
        seed_cli_bnkctl_modules_step()
        logger.info("   • running startup seed_auth_step...")
        seed_auth_step()
    except Exception as err:
        logger.warning("   ⚠️  Core app defaults seeding encountered non-fatal error: %s", err)


def run_all_seeds(engine=None) -> None:
    """Run all idempotent seeders in proper dependency order."""
    if engine is None:
        engine = create_engine(DATABASE_URL)

    logger.info("🌱 Starting idempotent seed runner...")
    seed_alembic_stamp(engine)
    seed_bluefield_images(engine)
    seed_bf_conf_templates(engine)
    seed_bnk_releases(engine)
    seed_bnk_deployable_releases(engine)
    seed_core_app_defaults()
    logger.info("✅ All seeds processed successfully.")


if __name__ == "__main__":
    engine = create_engine(DATABASE_URL)
    run_all_seeds(engine)
