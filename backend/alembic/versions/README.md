# Alembic Migrations Archive

The legacy Alembic incremental migrations (v2_001 through v2_163) have been archived into `backend/alembic/legacy_v2_archive/`.

As part of the **BNK Forge PoV Architecture Migration (Milestone 1)**, database schema management has transitioned to **Atlas Declarative Schema**:
- Active Schema Definition: `backend/schema/schema.hcl`
- Schema Tooling: Atlas (`arigaio/atlas`)
- Schema Execution: Applied declaratively on container startup via `entrypoint.sh` / `init_db.py` (`atlas schema apply`)
- Seeds: Managed idempotently via `backend/seeds/seed_runner.py`

Do not add new Alembic migration files here. Modify `backend/schema/schema.hcl` and update models in `backend/models/`.
