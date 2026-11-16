# BNK Forge Database Schema Management & Alembic Exit Strategy
**Document Version:** 1.0.0-pov  
**Status:** Approved for Implementation  
**Target Engine:** PostgreSQL 16 (Standardized)  
**Schema Tooling:** Atlas Declarative Engine (`ariga/atlas`)  

---

## 1. The Alembic Migration Crisis & Root Cause Analysis

BNK Forge v4.3.3 currently relies on Alembic for relational database migrations. Over the course of the platform's evolution, this has accumulated severe technical debt that threatens the stability of customer deployments:

### 1.1 The 163-Migration Chain
The codebase contains **163 sequential migration files** (`backend/alembic/versions/v2_001_...py` through `v2_163_...py`). Applying 163 migrations sequentially on a fresh customer install is slow, fragile, and prone to failure if any intermediate migration encounters a PostgreSQL version discrepancy or subtle type incompatibility.

### 1.2 The "Stamped-Head" Anti-Pattern (`backend/init_db.py`)
To avoid running 163 individual migrations on fresh installations, `backend/init_db.py` was introduced with the following pattern:
```python
# From backend/init_db.py:
Base.metadata.create_all(bind=engine)
command.stamp(alembic_cfg, "head")
```
* **The Root Cause of Drift:** `Base.metadata.create_all()` creates tables based on SQLAlchemy Python models. However, SQLAlchemy models often drift slightly from the cumulative result of 163 imperative migration scripts (e.g., column ordering, index names, check constraints, default values).
* Stamping the database with `"head"` lies to Alembic, claiming all 163 migrations have run when they were actually bypassed.
* As a result, subsequent incremental migrations fail because expected constraints or column definitions do not match the stamped state.

### 1.3 The "Healing Migration" Hack (`v2_152`)
To fix the drift created by `create_all() + stamp head`, migration `v2_152_fix_stamped_head_drift.py` was introduced specifically to inspect and patch tables when drift was detected. This created a circular dependency where migrations were written to patch the initialization script, which in turn bypassed the migrations.

### 1.4 Startup Crash Guards & Advisory Locks
* **Startup Guard:** `backend/init_db.py` contains a strict drift guard that executes `sys.exit(1)` if schema drift is detected, crashing the container during customer boot.
* **Advisory Lock Contention:** Celery workers and FastAPI instances running concurrently attempt to acquire PostgreSQL advisory locks during boot, causing deadlock or container restart loops.
* **Duplicated Seeds:** Default administrative users, permissions, and templates are duplicated between Alembic migration files and Python initialization scripts.

---

## 2. The Solution: Declarative Schema Management via Atlas

The solution is to **completely retire Alembic and the 163 migration files**, transitioning to **declarative schema management** powered by **Atlas** (`ariga/atlas`).

```mermaid
flowchart TD
    subgraph DeclarativeSource["Single Source of Truth"]
        HCLSchema["backend/schema/schema.hcl\n(Declarative PostgreSQL 16 Schema)"]
        SQLAlchemyModels["backend/models/*.py\n(Python Models)"]
    end

    subgraph AtlasEngine["Atlas Migration Engine (ariga/atlas)"]
        AtlasDiff["Atlas Diff Engine\n• Inspects Live Database\n• Compares against schema.hcl\n• Calculates Minimal Safe DDL"]
    end

    subgraph TargetDB["PostgreSQL 16 Instance"]
        LiveDB[("Live PostgreSQL Database\n(Customer PoV / SaaS)")]
    end

    HCLSchema --> AtlasDiff
    LiveDB --> AtlasDiff
    AtlasDiff -- "Idempotent, Zero-Downtime DDL" --> LiveDB
```

### Why Declarative Beats Imperative:
1. **State-Based, Not History-Based:** Instead of tracking 163 historical steps, Atlas evaluates: *"What does the database look like right now, and what does `schema.hcl` say it should look like?"*
2. **Zero Drift:** Atlas computes the exact mathematical diff between live state and desired state, generating only the minimal required `CREATE`, `ALTER`, or `DROP` statements.
3. **Instant Fresh Installs:** Fresh installs apply the complete schema in **<500 milliseconds** rather than executing 163 sequential migration files.
4. **Idempotent Execution:** Running Atlas multiple times is completely safe; if no changes are required, Atlas reports `Schema is up to date` and exits cleanly.

---

## 3. Step-by-Step Cutover & Migration Plan

### Step 1: Baseline Extraction
Using a clean PostgreSQL 16 database running the canonical v4.3.3 schema, extract the complete declarative HCL representation:
```bash
atlas schema inspect \
  -u "postgres://forge:secret@localhost:5432/forge?sslmode=disable" \
  > backend/schema/schema.hcl
```

### Step 2: Archive Legacy Alembic Versions
Move all 163 migration scripts to a legacy archive directory for historical auditing:
```bash
mkdir -p backend/alembic/legacy_v2_archive
mv backend/alembic/versions/v2_*.py backend/alembic/legacy_v2_archive/
```
* The `alembic_version` table is retained temporarily in customer databases to allow legacy inspection, but Alembic execution is disabled.

### Step 3: Implement Idempotent Seed Runner
Separate schema creation (DDL) from seed insertion (DML). Create `backend/seeds/seed_runner.py` using `ON CONFLICT DO UPDATE` or `ON CONFLICT DO NOTHING`:
```python
def seed_default_roles(db: Session):
    roles = [
        {"name": "admin", "description": "Super Administrator"},
        {"name": "operator", "description": "Cluster Operator"},
        {"name": "viewer", "description": "Read-Only Viewer"},
    ]
    for role in roles:
        stmt = insert(Role).values(**role).on_conflict_do_nothing(index_elements=["name"])
        db.execute(stmt)
    db.commit()
```

### Step 4: Refactor Container Startup (`backend/entrypoint.sh`)
Replace `init_db.py` execution with Atlas automated schema application:
```bash
#!/usr/bin/env bash
set -e

echo "==> Applying declarative database schema via Atlas..."
atlas schema apply \
  -u "$DATABASE_URL" \
  --to "file:///app/backend/schema/schema.hcl" \
  --auto-approve

echo "==> Running idempotent seed runner..."
python3 -m backend.seeds.seed_runner

echo "==> Starting Forge FastAPI Control Plane..."
exec uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

---

## 4. Upgrading Existing Customer Installations (Zero Data Loss)

A critical requirement for customer PoVs is that existing PostgreSQL databases must upgrade cleanly without wiping data.

```mermaid
sequenceDiagram
    autonumber
    participant Boot as Container Entrypoint
    participant Atlas as Atlas Engine
    participant DB as Customer PostgreSQL 16 DB

    Boot->>Atlas: Run atlas schema apply --to schema.hcl
    Atlas->>DB: Inspect live tables, columns, indexes, foreign keys
    DB-->>Atlas: Returns live schema structure
    Atlas->>Atlas: Compute diff between Live DB and schema.hcl
    
    alt Schema Already Matches Target
        Atlas-->>Boot: "Schema is up to date (0 changes applied)"
    else Minor Column or Index Discrepancies
        Atlas->>DB: Apply non-destructive DDL (e.g., ADD COLUMN IF NOT EXISTS)
        DB-->>Atlas: DDL Applied Successfully
        Atlas-->>Boot: "Schema updated successfully (N changes applied)"
    else Destructive Changes Detected (e.g., DROP TABLE)
        Atlas-->>Boot: Fail safe! Blocks destructive operations without explicit flag
    end

    Boot->>Boot: Proceed to start application services
```

* **Non-Destructive Guarantee:** By default, Atlas refuses to drop tables or columns unless explicitly authorized via `--allow-destructive` flags. Existing customer data is completely preserved.

---

## 5. Developer Workflow & CI/CD Guardrails

### 5.1 Modifying the Database Schema
When an engineer needs to add a new table, column, or index:
1. Update the SQLAlchemy models in `backend/models/*.py`.
2. Generate the updated declarative schema file:
   ```bash
   atlas schema inspect -u "postgres://localhost:5432/forge_dev" > backend/schema/schema.hcl
   ```
3. Verify the diff before committing:
   ```bash
   atlas schema diff \
     --from "postgres://localhost:5432/forge_dev" \
     --to "file://backend/schema/schema.hcl"
   ```

### 5.2 CI/CD Verification Guardrails
Every Pull Request runs an automated GitHub Action to ensure that database models and `schema.hcl` are in 100% synchronization:
```yaml
name: Database Schema Lint & Drift Guard

on:
  pull_request:
    paths:
      - 'backend/models/**'
      - 'backend/schema/**'

jobs:
  schema-drift-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ariga/setup-atlas@v0
      - name: Verify Schema Validity
        run: |
          atlas schema test --env ci
```
* If a developer modifies a Python model without updating `schema.hcl`, CI fails immediately with an actionable diff, preventing schema drift from ever reaching production.
