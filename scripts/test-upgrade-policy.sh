#!/bin/bash
#
# Automated tests for upgrade.sh policy guard paths.
# Runs in a temporary git clone to avoid affecting the real repo.
#
# Usage: ./scripts/test-upgrade-policy.sh
#
# Tests:
#   1. Dirty tree → exit 6 (unless --allow-dirty)
#   2. Non-staging branch → exit 6 (unless --allow-non-main)
#   3. Diverged HEAD → exit 6 (unless --allow-diverged)
#   4. Clean staging + synced → passes preflight (exits at build stage = expected)
#
# Note: Tests only exercise preflight logic. Build/restart phases are NOT tested
# here — they require Docker and are validated via server smoke tests.
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

PASS=0
FAIL=0
TOTAL=0

# Colors (if terminal supports them)
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

assert_exit_code() {
    local test_name="$1"
    local expected="$2"
    local actual="$3"
    TOTAL=$((TOTAL + 1))

    if [ "$actual" -eq "$expected" ]; then
        echo -e "  ${GREEN}✓${NC} ${test_name} (exit=$actual)"
        PASS=$((PASS + 1))
    else
        echo -e "  ${RED}✗${NC} ${test_name} — expected exit=$expected, got exit=$actual"
        FAIL=$((FAIL + 1))
    fi
}

# Preflight passed = exit code is NOT 6 (policy fail).
# In test env, script proceeds past preflight but fails at docker build (1 or 2).
assert_preflight_passed() {
    local test_name="$1"
    local actual="$2"
    TOTAL=$((TOTAL + 1))

    if [ "$actual" -ne 6 ] && [ "$actual" -ne 0 ]; then
        echo -e "  ${GREEN}✓${NC} ${test_name} (exit=$actual, preflight passed)"
        PASS=$((PASS + 1))
    else
        echo -e "  ${RED}✗${NC} ${test_name} — expected non-6/non-0 (preflight pass + build fail), got exit=$actual"
        FAIL=$((FAIL + 1))
    fi
}

assert_output_contains() {
    local test_name="$1"
    local pattern="$2"
    local output="$3"
    TOTAL=$((TOTAL + 1))

    if echo "$output" | grep -qE -e "$pattern"; then
        echo -e "  ${GREEN}✓${NC} ${test_name}"
        PASS=$((PASS + 1))
    else
        echo -e "  ${RED}✗${NC} ${test_name} — output missing pattern: $pattern"
        FAIL=$((FAIL + 1))
    fi
}

# ---------------------------------------------------------------------------
# Setup: create a temporary clone for isolation
# ---------------------------------------------------------------------------
echo "Setting up test environment..."
TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

# Create a minimal git repo that mimics our structure
mkdir -p "$TMPDIR/repo/scripts"
cp "$REPO_ROOT/upgrade.sh" "$TMPDIR/repo/upgrade.sh"
chmod +x "$TMPDIR/repo/upgrade.sh"

# Copy disk check script if it exists (preflight references it)
if [ -f "$REPO_ROOT/scripts/check-disk-space.sh" ]; then
    cp "$REPO_ROOT/scripts/check-disk-space.sh" "$TMPDIR/repo/scripts/"
    chmod +x "$TMPDIR/repo/scripts/check-disk-space.sh"
fi

if [ -f "$REPO_ROOT/MIN_UPGRADE_FROM" ]; then
    cp "$REPO_ROOT/MIN_UPGRADE_FROM" "$TMPDIR/repo/MIN_UPGRADE_FROM"
fi

# Initialize git repo with a commit
cd "$TMPDIR/repo"
git init -q
git checkout -b staging
echo "3.1.6" > VERSION
git add -A
git commit -q -m "initial"

# Create a fake remote so origin/staging exists
git clone -q --bare "$TMPDIR/repo" "$TMPDIR/remote.git"
git remote add origin "$TMPDIR/remote.git"
git fetch -q origin
git branch -q --set-upstream-to=origin/staging staging

echo ""
echo "=================================="
echo "  upgrade.sh Policy Guard Tests"
echo "=================================="
echo ""

# ---------------------------------------------------------------------------
# Test 1: Dirty tree should fail with exit 6
# ---------------------------------------------------------------------------
echo "Test group: dirty tree guard"

echo "dirty" > untracked-file.txt
git add untracked-file.txt

set +e
OUTPUT=$(./upgrade.sh --local --skip-disk-check 2>&1)
RC=$?
set -e

assert_exit_code "dirty tree fails without override" 6 "$RC"
assert_output_contains "dirty tree shows error message" "Working tree is not clean" "$OUTPUT"

# With override should pass preflight (will fail at docker compose — expected)
set +e
OUTPUT=$(./upgrade.sh --local --allow-dirty --skip-disk-check 2>&1)
RC=$?
set -e

assert_preflight_passed "dirty tree passes with --allow-dirty" "$RC"
assert_output_contains "dirty tree override logged" "Skipping dirty-tree check" "$OUTPUT"

# Clean up
git reset -q HEAD untracked-file.txt
rm -f untracked-file.txt

echo ""

# ---------------------------------------------------------------------------
# Test 2: Non-staging branch should fail with exit 6
# ---------------------------------------------------------------------------
echo "Test group: branch policy guard"

git checkout -q -b feature-branch

set +e
OUTPUT=$(./upgrade.sh --local --skip-disk-check 2>&1)
RC=$?
set -e

assert_exit_code "non-staging branch fails without override" 6 "$RC"
assert_output_contains "non-staging shows error message" "Upgrade must run from staging branch" "$OUTPUT"

# With override should pass branch check
set +e
OUTPUT=$(./upgrade.sh --local --allow-non-main --skip-disk-check 2>&1)
RC=$?
set -e

assert_preflight_passed "non-staging passes with --allow-non-main" "$RC"
assert_output_contains "non-staging override logged" "Skipping staging-branch check" "$OUTPUT"

git checkout -q staging
git branch -q -D feature-branch

echo ""

# ---------------------------------------------------------------------------
# Test 3: Diverged HEAD should fail with exit 6
# ---------------------------------------------------------------------------
echo "Test group: origin/staging sync guard"

# Create a local-only commit so HEAD diverges from origin/staging
echo "local change" >> VERSION
git add VERSION
git commit -q -m "local-only divergence"

set +e
OUTPUT=$(./upgrade.sh --local --skip-disk-check 2>&1)
RC=$?
set -e

assert_exit_code "diverged HEAD fails without override" 6 "$RC"
assert_output_contains "diverged shows error message" "Local HEAD does not match origin/staging" "$OUTPUT"

# With override should pass sync check
set +e
OUTPUT=$(./upgrade.sh --local --allow-diverged --skip-disk-check 2>&1)
RC=$?
set -e

assert_preflight_passed "diverged passes with --allow-diverged" "$RC"
assert_output_contains "diverged override logged" "Skipping origin/staging sync check" "$OUTPUT"

# Reset back to synced state
git reset -q --hard origin/staging

echo ""

# ---------------------------------------------------------------------------
# Test 4: Clean + synced should pass all preflight checks
# ---------------------------------------------------------------------------
echo "Test group: clean state preflight"

set +e
OUTPUT=$(./upgrade.sh --local --skip-disk-check 2>&1)
RC=$?
set -e

assert_preflight_passed "clean synced state passes preflight" "$RC"
assert_output_contains "preflight phase started" "##PHASE:preflight" "$OUTPUT"
assert_output_contains "tree check passed" "Git working tree clean" "$OUTPUT"
assert_output_contains "branch check passed" "Branch policy check passed" "$OUTPUT"
assert_output_contains "sync check passed" "Git HEAD aligned with origin/staging" "$OUTPUT"

echo ""

# ---------------------------------------------------------------------------
# Test 5: Version policy guard (commit changed but VERSION same)
# ---------------------------------------------------------------------------
echo "Test group: version policy guard (D17)"

# Push current state to remote so HEAD matches origin/staging
git push -q origin staging

# Now simulate: remote has a new commit with same VERSION
mkdir -p backend
echo "new file" > backend/newfile.txt
git add backend/newfile.txt
git commit -q -m "new commit same version"
git push -q origin staging

# Reset local to old commit, then run non-local upgrade so it pulls and hits D17
git reset -q --hard HEAD~1

set +e
OUTPUT=$(./upgrade.sh --skip-disk-check 2>&1)
RC=$?
set -e

assert_exit_code "same VERSION on new commit fails without override" 6 "$RC"
assert_output_contains "D17 error message shown" "Commit changed but VERSION was not bumped" "$OUTPUT"

# Reset local to old commit again and test --allow-same-version override
git reset -q --hard HEAD~1

set +e
OUTPUT=$(./upgrade.sh --allow-same-version --skip-disk-check 2>&1)
RC=$?
set -e

assert_preflight_passed "same VERSION passes with --allow-same-version" "$RC"
assert_output_contains "D17 override logged" "Version unchanged while commit changed" "$OUTPUT"

echo ""

# ---------------------------------------------------------------------------
# Test 6: Minimum upgrade version compatibility guard (MIN_UPGRADE_FROM)
# ---------------------------------------------------------------------------
echo "Test group: minimum upgrade version guard (MIN_UPGRADE_FROM)"

echo "2.9.0" > VERSION
echo "3.0.0" > MIN_UPGRADE_FROM
git add VERSION MIN_UPGRADE_FROM
git commit -q -m "simulate old version 2.9.0 below MIN_UPGRADE_FROM 3.0.0"
git push -q origin staging

set +e
OUTPUT=$(./upgrade.sh --local --skip-disk-check 2>&1)
RC=$?
set -e

assert_exit_code "version below MIN_UPGRADE_FROM fails without override" 6 "$RC"
assert_output_contains "MIN_UPGRADE_FROM error message shown" "Minimum supported upgrade version is 3.0.0" "$OUTPUT"

set +e
OUTPUT=$(./upgrade.sh --local --allow-unsupported-version --skip-disk-check 2>&1)
RC=$?
set -e

assert_preflight_passed "version below MIN_UPGRADE_FROM passes with --allow-unsupported-version" "$RC"
assert_output_contains "MIN_UPGRADE_FROM override logged" "Skipping minimum upgrade version check" "$OUTPUT"

echo ""

# ---------------------------------------------------------------------------
# Test 7: --skip-build and --help flags
# ---------------------------------------------------------------------------
echo "Test group: --skip-build and --help flags"

# Restore valid version >= MIN_UPGRADE_FROM
echo "3.1.0" > VERSION
git add VERSION
git commit -q -m "bump to 3.1.0 for skip-build test"
git push -q origin staging

set +e
HELP_OUTPUT=$(./upgrade.sh --help 2>&1)
HELP_RC=$?
set -e

assert_exit_code "--help exits with 0" 0 "$HELP_RC"
assert_output_contains "--help documents --skip-build" "--skip-build" "$HELP_OUTPUT"

set +e
UNKNOWN_OUTPUT=$(./upgrade.sh --unknown-flag 2>&1)
UNKNOWN_RC=$?
set -e

assert_exit_code "unknown flag exits with 2" 2 "$UNKNOWN_RC"
assert_output_contains "unknown flag prints error" "Unknown option: --unknown-flag" "$UNKNOWN_OUTPUT"

set +e
OUTPUT=$(./upgrade.sh --local --skip-build --skip-disk-check 2>&1)
RC=$?
set -e

# With --skip-build, upgrade.sh skips docker compose build (exit 2) and proceeds
# into ##PHASE:restart where docker compose up fails (exit 3) in the mock repo.
assert_exit_code "--skip-build skips build and reaches restart phase" 3 "$RC"
assert_output_contains "--skip-build logged" "Skipping image build \(--skip-build\)" "$OUTPUT"
assert_output_contains "reaches restart phase" "##PHASE:restart" "$OUTPUT"

echo ""

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo "=================================="
echo "  Results: ${PASS}/${TOTAL} passed, ${FAIL} failed"
echo "=================================="

if [ "$FAIL" -gt 0 ]; then
    echo -e "${RED}FAIL${NC}"
    exit 1
else
    echo -e "${GREEN}ALL PASSED${NC}"
    exit 0
fi
