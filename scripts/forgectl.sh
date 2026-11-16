#!/usr/bin/env bash
# ==============================================================================
# forgectl.sh — BNK Forge Air-Gap Packaging & Mirroring Helper
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
BIN_PATH="${REPO_ROOT}/bin/forgectl"

if [[ ! -f "${BIN_PATH}" ]]; then
    echo "[forgectl] Building forgectl binary..."
    (cd "${REPO_ROOT}" && go build -o "${BIN_PATH}" ./cmd/forgectl)
fi

exec "${BIN_PATH}" "$@"
