# Forge findings from the Topology Canvas work

Building the Topology Canvas (see [PLAN.md](PLAN.md)) surfaced the issues below in existing BNK Forge code.

The Canvas exercise is visualization only, so **none of these are fixed on this branch**. Each entry records:

- **Where:** the code location.
- **Evidence:** how it was observed.
- **Impact:** what users see.
- **Suggested fix:** how it could be fixed.
- **Status:** whether anything has been done.

Evidence comes from the local kind cluster seeded with [seed-kind.sh](seed-kind.sh) and the anonymized fixture `backend/tests/fixtures/bnk_canvas/sample_cluster.yaml`. It was gathered on 2026-10-25.

None of this has been checked yet against a cluster with BIG-IP Next controllers and a TMM running. That testing is still to do.

| # | Finding | Area | Severity | Status |
|---|---------|------|----------|--------|
| 1 | Gateway topology attaches policies by Gateway name only | backend | Bug: wrong data shown | Fix on a side branch, not merged |
| 2 | A missing optional CRD marks every BNK fetch partial and disables the cache | backend | Performance and noise | Open |
| 3 | Prettier drift in BNK frontend files, with no Prettier gate in CI | frontend tooling | Hygiene | Open |
| 4 | Six existing ESLint warnings | frontend | Hygiene | Open |
| 5 | pytest configuration and deprecation warnings | backend tooling | Hygiene | Open |
| 6 | Some F5 CRDs fail to install on recent Kubernetes | lab seeding (upstream F5) | Environment | Not a Forge issue |
| 7 | License status answers 502 when CWC is not installed, and the failure is not cached | backend | Noise | Open |
| 8 | Opening BNK views can write to the cluster and read Secret data (CWC client pod, TMM exec) | backend | Safety: read-only and second-Forge setups | Open |
| 9 | F5BnkGateway is not in Forge's resource registry | backend | Missing data | Worked around in the Canvas only |

The canvas's own limitations and its deviations from Gateway Atlas are listed separately at the end.

---

## 1. Gateway topology attaches policies by Gateway name only

**Where:** `backend/services/bnk/topology.py`, `_match_net_policies` (around line 472) and `_match_sec_policies` (around line 766), called at lines 222 and 304.

Both functions accept a target ref when `target.name == gw_name` and `kind == "Gateway"`. They never compare namespaces:

- the policy's own namespace, which is the default for a targetRef;
- or an explicit `targetRef.namespace`.

The legacy BNKNetPolicy and BNKSecPolicy paths go through the same functions.

**Evidence:** two namespaces each have a Gateway named `edge-gw`, and only `shop` has a SecPolicy. `GET /api/k8s/clusters/1/f5bnk/gateway-topology` still lists `shop/shop-sec` under `payments/edge-gw` as well as under `shop/edge-gw`. The Topology Canvas matches by namespace and name, so it shows the policy only on `shop/edge-gw`. The two views therefore disagree.

**Impact:** clusters that reuse Gateway names across tenants are common, for example one `edge-gw` per team. On those clusters the Gateway Topology view shows another tenant's firewall and network policies on a Gateway. Operators could conclude that a Gateway is protected when it is not.

**Suggested fix:** resolve each targetRef's namespace as `target.namespace or policy namespace`, and match on `(namespace, name)`. Add table-driven tests for:

- the same name in two namespaces;
- an explicit `targetRef.namespace`;
- the legacy kinds.

**Status:** a fix with tests exists as commit `3e49489` on the local branch `claude/bold-allen-53d637`:

- `topology.py`: +25 / −13
- `test_bnk_topology.py`: +87

It was left unmerged by choice, because this exercise does not change Forge behavior. Keep the branch.

## 2. A missing optional CRD marks every BNK fetch partial and disables the cache

**Where:** `backend/services/bnk/fetch.py`, `fetch_all_bnk_data`, in `safe_fetch` and the end of the function (around lines 180–316).

Every exception from `_fetch_from_k8s` sets `had_error = True`, including a 404 when a CRD is not installed. Any `had_error` adds `partial: True` and skips `cache.set(...)`.

**Evidence:** the local cluster does not install the optional CRD groups (AI, GSLB, scrape, Gateway API experimental routes). Each BNK page load logs a 404 for 24 resource types:

> aicredential aigateway aigatewayprofile aimodel aiprovider aitenant apppolicy bnknetpolicy bnksecpolicy f5biggslbinstance f5biggslbpool f5biggslbwideip f5biggslbzone f5bigloghslpub grpcroute inferencemodelrewrite inferencepool l4route scrape scrapeclass scrapetemplate tcproute tlsroute udproute

The backend has logged "Skipped caching BNK data for cluster 1 due to partial fetch failures" 69 times this session. In practice that is every load.

**Impact:**

- **No caching:** on any cluster without every optional CRD, which is most clusters, the 60-second cache never applies. Every BNK view refetches every resource type from the API server.
- **Wrong warning:** views that show `partial` warn that data "could not be read" when nothing failed. The Canvas shows this banner too, because it reads the same `partial` flag: "Some BIG-IP Next resource types could not be read; references to them may show as missing."
- **Log noise:** dozens of warnings per page load.

**Suggested fix:** treat a 404 from listing a custom resource (CRD not installed) as an empty list, not an error. Optionally, record those types in an `absent_types` field so views can say "not installed" instead of "could not be read". Keep `partial` for real failures: 403, 5xx and timeouts.

**Status:** open.

## 3. Prettier drift in BNK frontend files, with no Prettier gate in CI

**Where:** `frontend-v2/src/types/f5bnk.ts` and `frontend-v2/src/pages/f5bnk-parts/index.ts`. Both already fail `prettier --check` at the base commit (`d0b65e7`), before any Canvas change. CI's `lint-frontend` job runs `make lint-frontend` (ESLint only) and `typecheck-frontend` runs tsc. `package.json` has a `format` script (`prettier --write`) but no check script, and nothing in CI runs Prettier.

**Impact:** running Prettier on a file it doesn't already match reformats the whole file. That turns small diffs into large ones. The Canvas work hit this in `lib/api/kubernetes.ts` and backed it out in commit `d8ed2f6`.

**Suggested fix:** run `prettier --write` across `frontend-v2/src` in one dedicated formatting commit. Then add `prettier --check` (or `eslint-plugin-prettier`) to CI.

**Status:** open. The Canvas commits keep existing files' formatting as it is.

## 4. Six existing ESLint warnings

`npx eslint src` in `frontend-v2` reports 0 errors and 6 warnings, all in files outside the Canvas work:

| File | Line | Rule |
|------|------|------|
| `components/k8s/ResourceCreateDialog.tsx` | 26 | `react-refresh/only-export-components` |
| `components/layout/InnerSidebar.tsx` | 15 | `react-refresh/only-export-components` |
| `pages/Stacks.tsx` | 264 | `no-restricted-syntax` (raw `<table>` instead of the shadcn Table) |
| `pages/ai/SmartLlmRouterPage.tsx` | 111 | `react-hooks/exhaustive-deps` (`clusters` changes every render) |
| `pages/observability/LlmDashboard.tsx` | 325 | `react-hooks/exhaustive-deps` (`clusters`) |
| `pages/observability/LlmDashboard.tsx` | 2850 | `react-hooks/exhaustive-deps` (`lokiSeries`) |

**Impact:** the three `exhaustive-deps` warnings are possible real issues. The memoized values and effects recompute on every render, which can cause extra fetches or re-renders on the AI and LLM pages. The others are hygiene.

**Suggested fix:**

- wrap `clusters` and `lokiSeries` in `useMemo`;
- move the non-component exports to separate files;
- switch `Stacks.tsx` to the shadcn Table.

**Status:** open.

## 5. pytest configuration and deprecation warnings

Running any backend test file prints these warnings:

- `asyncio_default_fixture_loop_scope` is unset (pytest-asyncio deprecation). Set it in `[tool.pytest.ini_options]` in `backend/pyproject.toml`.
- `Unknown config option: collect_ignore_glob` (`pyproject.toml:121`). It is a `conftest.py` variable, not an ini option, so the glob is silently ignored. The intended exclusions, `bnk-operator/*` and `proxy/*`, therefore do not apply.
- Pydantic v2 class-based `Config` deprecations in:
  - `schemas/bnk.py`, lines 130, 260 and 339;
  - `core/config.py`, line 329.

  Replace them with `model_config = ConfigDict(...)` or `SettingsConfigDict(...)`.
- Library deprecations:
  - `passlib` imports `crypt`, which is removed in Python 3.13;
  - `starlette.testclient` with `httpx`.

**Impact:** low today. The `collect_ignore_glob` one means test collection may scan directories it was meant to skip. The `crypt` one blocks a Python 3.13 upgrade.

**Status:** open.

## 6. Some F5 CRDs fail to install on recent Kubernetes

The local kind cluster runs Kubernetes v1.37.0. While seeding it, the API server's structural-schema validation rejected some F5 CRDs because they declare an empty `default`. The rejected CRDs include `F5BigLogHslpub` and the GSLB pool, which is why they appear among the 404s in finding 2.

This is in F5's published CRDs, not in Forge. It matters only for lab and CI seeding: Forge should keep working when those kinds are absent, which links to finding 2.

**Status:** the rejected CRDs were left out of the local cluster. [seed-kind.sh](seed-kind.sh) expects the CRDs to be installed already. Nothing to fix in Forge.

## 7. License status answers 502 when CWC is not installed

**Where:** `backend/routes/licensing.py`, `get_license_status_endpoint` (around line 241). It calls the legacy path `services/qkview_service.py` `get_license_status`.

**Evidence:** on the kind cluster, with no CWC service, every load of the F5 BNK overview requests `GET /api/licensing/1/status` and gets `502 Bad Gateway`. Two such requests appear in the browser console on each load, and the backend logs "CWC service 'f5-spk-cwc' not found in any namespace". Only success is cached (120 seconds), so the lookup repeats on every load.

**Impact:**

- **Wrong signal:** a 502 means an upstream failed, but here licensing is simply not installed.
- **Noise:** red console errors on every load.
- **Wasted calls:** the CWC namespace and Service lookups rerun on each request.

**Suggested fix:** return 200 with `{"installed": false}`, or 404, when no CWC Service exists, and cache that answer like a success.

**Status:** open.

## 8. Opening BNK views can write to the cluster and read Secret data

**Where:** `backend/services/qkview_service.py`, `_cwc_request` (around line 698), reached from the license status that the F5 BNK overview loads. Also `backend/services/bnk/traffic_stats.py`, reached from `/f5bnk/data`, which every BNK view prefetches.

On a cluster with CWC installed, a license status request:

1. reads the CWC admin-token Secret's data (`_get_admin_token`);
2. finds a pod labelled `bnk-forge-agent` in the CWC namespace, or **creates one** (`_create_client_pod`, image `alpine/curl:latest`) and leaves it running for reuse;
3. runs `curl` inside it with `kubectl exec`.

Traffic stats also `exec` into the TMM debug sidecar (`tmctl`, `configview`).

**Evidence:** found while checking whether a second Forge could safely connect to a cluster another Forge already manages. This is from reading the code; it has not been reproduced on a CWC cluster yet.

**Impact:**

- **Browsing writes to the cluster.** Opening a read-only page creates a pod, and nothing in the UI says so.
- **Secret data is read** for an overview tile.
- **Shared state between Forges.** Two Forges managing one cluster find the same `bnk-forge-agent` pod by label and reuse it, so they share state rather than clash.
- **Read-only credentials break these paths.** With get/list only, they fail with 403: the license tile shows an error, and traffic counters stay unavailable.

**Suggested fix:**

- Create the client pod only on an explicit licensing or QKView action.
- Treat a 403 as "read-only access" rather than an error.
- Document the RBAC each feature needs, so a read-only (viewer) Forge is a supported setup.

**Status:** open. For testing on a cluster another Forge already manages, use a kubeconfig bound to a get/list-only role. The Kubernetes `view` ClusterRole excludes Secrets and `pods/exec`. Grant `pods/exec` on the TMM pods only if real traffic counters are needed.

## 9. F5BnkGateway is not in Forge's resource registry

**Where:** `backend/core/k8s_resource_registry.py` and `BNK_RESOURCE_TYPES` (`backend/services/bnk/helpers.py`). BIG-IP Next 2.x installs the `f5-bnkgateways.k8s.f5net.com` CRD (kind `F5BnkGateway`, namespaced), and a Gateway can name one in `spec.infrastructure.parametersRef`.

**Evidence:** on a BIG-IP Next 2.4 cluster, a Gateway's `parametersRef` names an F5BnkGateway that does not exist; the cluster has the CRD and no F5BnkGateway objects. Forge never lists the kind, so none of its BNK views can tell whether such a reference resolves.

**Impact:** a Gateway whose infrastructure parameters are missing looks healthy in Forge's tree and health views.

**Suggested fix:** register `f5bnkgateway` (group `k8s.f5net.com`, version `v1`, plural `f5-bnkgateways`) and add it to `BNK_RESOURCE_TYPES`, treating a missing CRD as absent (see finding 2).

**Status:** the Canvas lists F5BnkGateways itself (`backend/services/bnk/canvas_fetch.py`, get/list only) and reports the missing one as a broken reference. The registry and the shared fetch are unchanged.

---

## Canvas limitations and deviations from Gateway Atlas

These describe the new view itself, not existing Forge code. They are listed for completeness.

- **Relationship kinds not in Atlas:**
  - `grant` is drawn as a peer edge anchored on its target, in lane 1;
  - `network` is drawn as a peer edge anchored on its source, in lane 1.
- **EgressGateway rows:** EgressGateway is treated as an entry tier, so it starts its own family row.
- **No workloads:** traffic stops at Services. Forge does not read Deployments, Pods behind Services or NetworkAttachmentDefinitions for this view. Network attachments appear only as card facts.
- **Not ported from Atlas:**
  - the Classic layout;
  - the compact mode and folded columns;
  - the hover popover;
  - camera persistence.
- **Forge additions not in Atlas:**
  - TMM traffic counters on cards and listener edges (`trafficOverlay.ts`);
  - full-path tracing on selection, where Atlas highlights only neighbours (`tracePath.ts`);
  - a vector SVG export drawn from the layout; Atlas rasterises the page instead (`exportSvg.ts`).
- **Disabled switches are hard to see:** Forge's shared `Switch` component renders the disabled state at half opacity on a muted track, so the disabled **Traffic** switch almost disappears in light mode. Its tooltip still explains why it is off.
- **Selection after closing the panel:** when the detail panel closes, the card stays highlighted until Escape or a click on the background.
- **Secrets:** Secret references are placeholders built from the referencing object. Secret objects are never read, so these cards show "not read" rather than a real status.
