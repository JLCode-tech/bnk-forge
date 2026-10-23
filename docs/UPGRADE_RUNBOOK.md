# Server Upgrade Runbook

Canonical guide for upgrading BNK Forge on the test server (`.91`).

---

## Normal Upgrade (recommended)

```bash
# 1. Push code from local
git push origin staging

# 2. SSH to server
ssh ubuntu@10.176.11.91

# 3. Pull latest
cd /home/ubuntu/bnk-forge
git pull --ff-only

# 4. Run safe upgrade
make upgrade-safe
```

This runs `./upgrade.sh --local` which enforces:
- Git working tree is clean
- Branch is `staging`
- HEAD matches `origin/staging`
- Disk usage below critical threshold
- After build/restart: container health, backend log sanity, health endpoint

---

## Override Flags

Use overrides **only when you understand the risk**.

| Flag | What it skips | When to use |
|------|---------------|-------------|
| `--skip-build` | `docker compose build` step | Deploying pre-built GHCR images (`user-pack` or tagged release) |
| `--allow-dirty` | Clean working tree check | Agent left stale files; you verified they're safe |
| `--allow-diverged` | HEAD == origin/staging check | Intentionally deploying a local-only commit |
| `--allow-non-main` | Must be on `staging` branch | Testing a feature branch on server (rare) |
| `--allow-same-version` | VERSION bump policy (D17) | Docs-only or .agent-only changes |
| `--allow-unsupported-version` | `MIN_UPGRADE_FROM` version check | Upgrading across a major baseline after manual DB prep |
| `--skip-disk-check` | Disk usage threshold | Disk script missing or false positive |
| `--no-cache` | Docker build cache | requirements.txt or Dockerfile tool versions changed |

### Example: deploy with overrides

```bash
./upgrade.sh --local --allow-dirty --allow-same-version
```

---

## Version Compatibility & Automatic Pre-Migration Backup

- **Minimum Upgrade Version (`MIN_UPGRADE_FROM`)**: The repository root file `MIN_UPGRADE_FROM` (currently `3.0.0`) defines the oldest release that can be upgraded directly in-place to the current version. `upgrade.sh` verifies `OLD_VERSION >= MIN_UPGRADE_FROM` before building containers.
- **Smart Build Coverage**: `upgrade.sh` detects changes across `backend/`, `frontend-v2/`, `proxy/`, `mcp_server/` (`Dockerfile.mcp`), and `agent/` (`Dockerfile.agent`), rebuilding only modified services and automatically refreshing `bnk-forge-proxy` upstream DNS when `backend` or `frontend` containers are recreated.
- **Pre-Migration Database Backup**: Immediately before running `alembic upgrade head` in `##PHASE:migrate`, `upgrade.sh` dumps the running PostgreSQL database to `./backups/pre-upgrade-<old-version>-<timestamp>.sql.gz`.

---

## Failure Recovery

### Preflight failed (exit 6)

Script stopped before any changes were made. Fix the reported issue and retry.

| Error | Fix |
|-------|-----|
| Working tree is not clean | `git stash` or `git checkout -- .` |
| Local HEAD does not match origin/staging | `git pull --ff-only` |
| Upgrade must run from staging branch | `git checkout staging` |
| Disk usage above critical threshold | `make clean-docker` or `./scripts/docker-cleanup.sh` |
| VERSION was not bumped | Bump `VERSION` file, commit, push, pull again |
| Minimum supported upgrade version is X.Y.Z | Upgrade to the intermediate baseline version X.Y.Z first |

### Build failed (exit 2)

No containers were restarted. Previous version is still running.

```bash
# Check build output for errors, then retry
docker compose build 2>&1 | tail -50
make upgrade-safe
```

### Restart failed (exit 3)

Some containers may be in a bad state.

```bash
docker compose ps
docker compose logs --tail 50 <failed-service>
docker compose up -d --force-recreate
```

### Migration failed (exit 4)

Services are running but database may be inconsistent. You can either fix and re-run migrations or restore the automatic pre-upgrade backup created in `./backups/`:

```bash
docker exec bnk-forge-backend alembic upgrade head
# If that fails, check migration history:
docker exec bnk-forge-backend alembic history --verbose | head -20

# Or restore from the automatic pre-upgrade backup:
gunzip -c ./backups/pre-upgrade-<version>-<timestamp>.sql.gz | \
  docker exec -i bnk-forge-postgres psql -U bnkforge -d bnkforge
```

### Health check failed (exit 5)

Services started but aren't healthy.

```bash
# Check which service is unhealthy
docker ps --format 'table {{.Names}}\t{{.Status}}'

# Check backend logs
docker logs bnk-forge-backend --tail 50

# Check health endpoint directly
docker exec bnk-forge-backend curl -s http://localhost:8000/api/system/health
```

---

## Post-Upgrade Verification (mandatory)

Always run these three checks after any upgrade:

```bash
# 1. All containers healthy
docker ps --format 'table {{.Names}}\t{{.Status}}' | grep bnk-forge

# 2. Backend logs clean
docker logs bnk-forge-backend --tail 20

# 3. Health endpoint responds
curl -sk https://localhost/api/system/health
```

---

## Testing the Upgrade Script

Run the automated policy guard tests locally:

```bash
./scripts/test-upgrade-policy.sh
```

This validates all preflight guard paths (dirty tree, non-staging branch, diverged HEAD, D17 version bump policy, and `MIN_UPGRADE_FROM` version compatibility) in an isolated temporary git repo.

---

## Related Files

- `upgrade.sh` — the upgrade script
- `MIN_UPGRADE_FROM` — minimum supported direct-upgrade baseline version
- `Makefile` — `make upgrade-safe` wrapper
- `scripts/test-upgrade-policy.sh` — automated policy tests
- `scripts/check-disk-space.sh` — disk threshold checker
- `docs/DISK_MANAGEMENT.md` — disk cleanup guide
