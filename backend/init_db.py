#!/usr/bin/env python3
"""
Initialize database for BNK-Forge installations.

This script:
1. Applies the declarative database schema via Atlas (file: schema/schema.hcl).
   If Atlas CLI is not available, falls back to SQLAlchemy Base.metadata.create_all.
2. Stamps the database with the latest Alembic migration version (v2_163).
3. Verifies schema drift against the ORM metadata.
4. Seeds initial and catalog data idempotently (BlueField images, templates, BNK releases, system defaults).

Idempotent: safe to run on fresh or existing databases.
"""
import os
import shutil
import subprocess
import sys

from sqlalchemy import create_engine

from database import DATABASE_URL
from models import Base
from seeds.seed_runner import (
    run_all_seeds,
    seed_alembic_stamp,
    seed_bf_conf_templates,
    seed_bluefield_images,
)


def apply_atlas_schema(database_url: str, schema_path: str) -> bool:
    """Apply schema via Atlas declarative schema engine.

    Returns True if successfully applied, False if Atlas binary or schema file is unavailable.
    """
    atlas_bin = shutil.which("atlas") or ("/usr/local/bin/atlas" if os.path.exists("/usr/local/bin/atlas") else None)
    if not atlas_bin or not os.path.exists(schema_path):
        return False

    atlas_url = database_url
    if "sslmode=" not in atlas_url and not atlas_url.startswith("sqlite"):
        sep = "&" if "?" in atlas_url else "?"
        atlas_url = f"{atlas_url}{sep}sslmode=disable"

    print(f"\n📊 Applying declarative schema via Atlas ({schema_path})...")
    cmd = [
        atlas_bin,
        "schema",
        "apply",
        "--url",
        atlas_url,
        "--to",
        f"file://{schema_path}",
        "--auto-approve",
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"Atlas schema apply error: {result.stderr}")
        raise RuntimeError(f"Atlas schema apply failed: {result.stderr}")
    print(result.stdout.strip())
    print("✅ Atlas declarative schema applied successfully")
    return True


def init_database() -> bool:
    """Initialize database with declarative Atlas schema, drift check, and seeds."""
    print("🔧 Initializing BNK-Forge database...")

    # Create engine
    engine = create_engine(DATABASE_URL)

    # Locate schema.hcl
    schema_path = os.environ.get("ATLAS_SCHEMA_PATH")
    if not schema_path:
        base_dir = os.path.dirname(os.path.abspath(__file__))
        schema_path = os.path.join(base_dir, "schema", "schema.hcl")

    # Try Atlas declarative schema apply first
    applied = False
    if os.path.exists(schema_path):
        try:
            applied = apply_atlas_schema(DATABASE_URL, schema_path)
        except Exception as e:
            print(f"⚠️  Atlas execution failed: {e}")
            raise

    if not applied:
        # Fallback for environments without atlas binary (e.g. SQLite tests)
        print("\n📊 Creating tables from SQLAlchemy models (Atlas unavailable)...")
        Base.metadata.create_all(bind=engine)
        print("✅ Tables created via SQLAlchemy")

    # Stamp database with latest migration version for backward compatibility
    print("\n📝 Stamping database with latest migration version (v2_163)...")
    seed_alembic_stamp(engine)
    print("✅ Database stamped with v2_163")

    # Drift guard (#161): verify ORM metadata matches the live DB
    try:
        from startup_steps import _detect_missing_schema

        with engine.connect() as conn:
            missing = _detect_missing_schema(conn)
        if missing:
            print("\n❌ Schema drift after init — the DB is MISSING objects the ORM expects:")
            for item in missing:
                print(f"   - {item}")
            raise RuntimeError(
                "init_db produced a schema the ORM does not match — refusing to declare success"
            )
        print("✅ Schema drift check passed (ORM matches DB)")
    except ImportError:
        pass

    # Seed all initial and catalog data idempotently
    print("\n🌱 Running idempotent seeds...")
    run_all_seeds(engine)
    print("✅ Initial data seeded")

    print("\n✅ Database initialization complete!")
    return True


def seed_initial_data(engine) -> None:
    """Backward-compatibility wrapper for legacy tests calling seed_initial_data directly."""
    seed_bluefield_images(engine)
    seed_bf_conf_templates(engine)


if __name__ == "__main__":
    try:
        success = init_database()
        sys.exit(0 if success else 1)
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback

        traceback.print_exc()
        sys.exit(1)
