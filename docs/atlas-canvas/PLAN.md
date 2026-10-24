# Topology Canvas for BNK Forge — plan

Ported from [Gateway Atlas](https://github.com/tareqaminul/gateway-atlas-guide) by its author, Apache-2.0. Each ported file carries a header comment naming its origin.

## Context

BNK Forge is a full management plane for F5 BIG-IP Next for Kubernetes, but its topology view is weak. "Object Topology Graph" is a collapsible text tree (`F5BNKTopologyViewer.tsx`, built server-side in `backend/services/bnk/topology.py`).

Gateway Atlas's Canvas does visualization well:
- Families rows;
- relationship-typed Bezier edges with labels;
- class tiles and namespace frames;
- exact-identity relationships with broken and unresolved states.

The side project brings that Canvas into Forge.

**Decisions (maintainer, 2026-10-24):**
- **Native port:** the Canvas logic is re-implemented in Forge's own stack (Apache-2.0, ported from Gateway Atlas by its author).
- **Repo:** the fork only, `tareqaminul/bnk-forge-jl411`, on branch `feat/bnk-topology-canvas`, kept rebased on `upstream` (JLCode-tech/bnk-forge).
- **Data:** Forge's own live cluster data.
- **Scope:** BNK-centred, plus what it touches.
- **Placement:** a new view beside the existing tree.
- **Gateway Atlas:** unchanged and independent; it keeps its own releases.

## Findings that shape the design

**Forge stack:**
- frontend: React 18 and TypeScript strict, Vite, shadcn/Tailwind, react-query, axios, and `reactflow` v11 with dagre (already used by `ResourceTopologyGraph.tsx`);
- backend: FastAPI on Python 3.11, reading clusters with the `kubernetes` client and a stored kubeconfig;
- CI: ruff, mypy, tsc, ESLint and Prettier, pytest, Vitest, Playwright;
- conventions: conventional commits; `npm run generate:types` after any OpenAPI change;
- license: Apache-2.0, the same as Atlas.

**Data already available:**
- `fetch_all_bnk_data()` (`backend/services/bnk/fetch.py:135`) fetches every BNK and Gateway API resource raw, in parallel, with a 60-second cache;
- `/f5bnk/data` returns the joined tree;
- a generic graph `/api/k8s/clusters/{id}/topology` exists (`topology_builder_service.py`). Its node ids are `kind/ns/name` with no API group, and it has no L4Route, data-plane or listener semantics.

**Forge bug to avoid:** `_match_net_policies` and `_match_sec_policies` match Gateways by name only, so two Gateways with the same name in different namespaces get each other's policies.

**What to port from Atlas** (dense TypeScript, about 2,300 lines for the Canvas; Go analyzer about 1,300 lines):
- `familiesLayout.ts`, `topologyHierarchy.ts`, `edgePresentation.ts`, `edgeLabelPlacement.ts`, `layoutPacking.ts`;
- card facts;
- the relationship rules from `internal/analyzer` (`analyzer.go` refs, `attachment.go`, `f5.go`).

**Not ported:** Classic layout and ELK, Migration, the CRD explorer, YAML import, snapshots.

## Status (2026-10-25)

- **Phases 0–4 are done locally**, on the fork's `feat/bnk-topology-canvas` branch. Nothing is pushed yet.
- **User guide:** [docs/TOPOLOGY_CANVAS.md](../TOPOLOGY_CANVAS.md). Forge has no `docs/guides/` folder, so the guide follows its top-level docs and `docs/images/` convention.
- **Verified** on the anonymized kind lab only. Still to do:
  - test against a cluster with BIG-IP Next controllers and a TMM, using a get/list-only kubeconfig (see [FORGE-FINDINGS.md](FORGE-FINDINGS.md), finding 8);
  - derive more anonymized fixtures and tests from that cluster.
- **Issues found in existing Forge code** are listed, not fixed, in [FORGE-FINDINGS.md](FORGE-FINDINGS.md).

## Approach

### Phase 0 — prepare the fork (done 2026-10-24: steps 1–4)
1. Set this repo's git identity to `Aminul I. Tareq <tareq06@gmail.com>`.
2. Add `upstream` = `https://github.com/JLCode-tech/bnk-forge.git`.
3. Create branch `feat/bnk-topology-canvas`.
4. Save this plan as `docs/atlas-canvas/PLAN.md`, with a short attribution note: ported from Gateway Atlas (Apache-2.0); each ported file gets a header comment.
5. Run Forge locally: `make dev-setup`, then `make local-deploy`; open https://localhost and get the admin password from `/app/keys/initial_admin_password`.
6. Set up a dev cluster: a local `kind` cluster with the BNK CRDs (obtained under F5's terms, used locally only, never committed) and **anonymized** sample objects (Gateways, L4Route, NetPolicy, VLANs, SNAT, Egress, CNEInstance). No F5 controllers are needed, because objects only need to exist. Register the cluster in Forge with a read-only kubeconfig.

### Phase 1 — backend graph builder (Python, pure and unit-tested)
- **New file `backend/services/bnk/canvas_graph.py`:** `build_canvas_graph(raw: dict[str, list[dict]]) -> CanvasGraph`. It is a pure function that ports Atlas's rules for the BNK scope:
  - **Identity:** exact `group/version/kind/namespace/name`; ids must include the group.
  - **Traffic relationships:** GatewayClass → Gateway (class); Route → Gateway (`parentRefs`, honouring `sectionName` and `port`); Route → Service (`backendRefs`, honouring `namespace`); `ReferenceGrant` required across namespaces. The Route kinds are HTTP, GRPC, TCP, UDP and TLS routes, plus L4Route in both `gateway.k8s.f5.com` and the legacy `gateway.k8s.f5net.com`.
  - **Policies and extensions:**
    - NetPolicy, SecPolicy and AppPolicy (and the legacy BNK*Policy kinds): `targetRefs` → policy edges; `extensionRefs` → configuration edges (FwPolicy, iRules);
    - Gateway `infrastructure.parametersRef` → GatewaySettings;
    - EgressGateway → class and params;
    - CNEInstance → issuer and pull Secret (metadata only).
  - **Data plane** (beyond Atlas today; from the planned CNE baseline rules): GatewaySettings → Infra; Infra/VLAN → network attachment; F5SPKEgress → SnatPool; VLAN → self-IPs, kept as facts on the card; static routes.
  - **Edge status:** `valid`, `broken` or `unresolved`, plus the source field. Example: `spec.rules[0].backendRefs[0]`.
  - **Findings:** a small set — missing reference, cross-namespace reference without a grant, and a listener that matches no route (Atlas attachment rules).
  - **Facts per card:** listeners (protocol and port), VIPs, conditions (Accepted, Programmed), and backends' ports and weights.
  - **Secrets:** metadata only, never data.
- **Endpoint:** `GET /api/k8s/clusters/{id}/f5bnk/canvas?namespace=&force=` in `routes/k8s/f5bnk.py`.
  - It reuses `fetch_all_bnk_data` and its cache.
  - The response schema `BnkCanvasResponse` goes in `schemas/bnk.py`: `{resources, edges, findings, warnings, generatedAt}`.
  - It requires the viewer role and is read-only.
- **Tests:** `tests/unit/test_bnk_canvas_graph.py` — table-driven, one row per relationship rule (namespace-scoped policy matching included), plus a golden JSON of an anonymized BNK fixture.

### Phase 2 — frontend Canvas view (TypeScript, Forge style)
- **New folder `frontend-v2/src/components/k8s/bnk-canvas/`:**
  - Ported modules, rewritten to pass Forge's strict ESLint and Prettier: `familiesLayout.ts` (bands per GatewayClass, family rows, guest class tiles, shared-card median, tucked and feeder namespaces), `hierarchy.ts` (tiers: class → entry → route → service; policy and configuration lanes), `edgeStyles.ts` (per-relationship stroke and dash), `edgeLabels.ts` (collision-aware label placement), `packing.ts`.
  - `BnkCanvas.tsx` renders on the existing **reactflow v11**, with no new graph library. It has custom node cards (Forge theme tokens, kind badge, condition dot, facts), custom Bezier edges with labels, namespace and class frames, a legend, fit, zoom, lock and a minimap.
  - `F5BNKCanvasView.tsx` holds a toolbar (Stop at Services, Hide Secrets, fit) and a findings strip.
  - `useBnkCanvas` hook and `api.getBnkCanvas`, following the existing `useBnk.ts` and `lib/api/kubernetes.ts` patterns.
- **Register the view:**
  - `VIEW_CANVAS` ("Topology Canvas") in `pages/f5bnk-parts/bnk-constants.ts`;
  - a `case` in `renderSpecialView()` (`pages/F5BNK.tsx:215`);
  - deep link: `/bnk?view=view-canvas`.
- **Reuse Forge:** clicking a card emits the existing `TopologyResourceSelection` and opens `F5BNKDetailPanel`, so edit and delete come from Forge.
- **Tests:** ported Vitest layout tests (families rows, guest tiles, shared median, tucked and feeder), a component test with msw, and regenerated OpenAPI types.

### Phase 3 — Forge-only value
- Overlay `trafficStats` (listener and egress connections, firewall hits) on cards and edges.
- Path highlight from a Gateway.
- Save image as SVG.

### Phase 4 — docs and CI
- A docs page (`docs/guides/` style) with screenshots from the anonymized kind cluster.
- A README feature line.
- Green `make quick-check` and CI: ruff, mypy, tsc, ESLint, pytest, Vitest.
- Conventional commits, pushed to the fork's feature branch, then merged to the fork's `main`. Nothing goes upstream unless you decide later.

## Verification
- **Backend:** `pytest tests/unit/test_bnk_canvas_graph.py` (rule table and golden), plus ruff and mypy.
- **Frontend:** `npm run typecheck`, `lint`, `test`; `generate:types` clean.
- **End to end:** `make local-deploy` with the kind cluster seeded with anonymized BNK objects. Open `/bnk?view=view-canvas` and check:
  - Gateways in class bands;
  - L4Routes to Services with labels;
  - NetPolicy and SecPolicy lanes;
  - data-plane cards linked;
  - same-name Gateways in two namespaces keep their own policies;
  - clicking a card opens Forge's detail panel;
  - the existing tree, Traffic Flow and Policy Matrix views are unchanged.
- **Privacy:** before each push, run a `grep` check for lab names and hosts. No Secret data in responses, matching the Atlas rule.
