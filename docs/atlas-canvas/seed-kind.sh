#!/usr/bin/env bash
# Seed a local kind cluster with the anonymized Topology Canvas sample.
#
# The BIG-IP Next CRDs are not part of this repository (F5's schemas are not redistributable): install the
# ones you obtained under F5's terms first. The Gateway API CRDs (standard channel) are also required.
#
#   docs/atlas-canvas/seed-kind.sh [kube-context]      # default context: kind-bnk-canvas
#
# Objects are applied server-side; `status` blocks are then written through the status subresource so the
# Canvas shows conditions without a running controller. Uses PyYAML from backend/.venv (make dev-setup).
set -euo pipefail

CONTEXT="${1:-kind-bnk-canvas}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FIXTURE="$ROOT/backend/tests/fixtures/bnk_canvas/sample_cluster.yaml"
PYTHON="$ROOT/backend/.venv/bin/python"

kubectl --context "$CONTEXT" apply --server-side --field-manager=canvas-seed -f "$FIXTURE"

"$PYTHON" - "$FIXTURE" <<'EOF' | while IFS=$'\t' read -r resource namespace name patch; do
import json
import sys

import yaml

for item in yaml.safe_load(open(sys.argv[1]))["items"]:
    if not item.get("status"):
        continue
    group, _, version = item["apiVersion"].rpartition("/")
    resource = f"{item['kind'].lower()}.{version}.{group}" if group else item["kind"].lower()
    meta = item["metadata"]
    print(resource, meta.get("namespace") or "-", meta["name"], json.dumps({"status": item["status"]}), sep="\t")
EOF
  ns_args=()
  [[ "$namespace" != "-" ]] && ns_args=(-n "$namespace")
  kubectl --context "$CONTEXT" ${ns_args[@]+"${ns_args[@]}"} patch "$resource" "$name" --subresource=status --type=merge -p "$patch"
done
