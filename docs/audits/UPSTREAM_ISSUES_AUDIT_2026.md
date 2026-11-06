# Upstream Issue Audit: `f5devcentral/bnk-forge` vs `JLCode-tech/bnk-forge`

> **Audit Date**: 2026-11-06  
> **Fork Version**: `v4.3.3` (`JLCode-tech/bnk-forge`)  
> **Upstream Repository**: `f5devcentral/bnk-forge` (98 open issues audited)  

## Executive Summary

An exhaustive audit of all 98 open issues in the upstream repository was conducted to assess applicability to the current fork (`JLCode-tech/bnk-forge` v4.3.3).

| Category | Count | Percentage | Description |
| :--- | :--- | :--- | :--- |
| **Resolved in Fork** | 16 | 16.3% | Defect, reliability, or feature gaps that have already been fixed and shipped in `JLCode-tech/bnk-forge`. |
| **Upstream-Specific Infra / Docs** | 19 | 19.4% | Upstream GitHub permissions, branch rules, internal test runners, or upstream ADR docs not applicable to the fork. |
| **Relevant / Actionable for Fork** | 63 | 64.3% | Valid defects, enhancements, or architectural alignments that can be prioritized for upcoming fork releases. |

## Key Highlights & Top Actionable Items

Among the 63 relevant issues, the following have the highest operational and architectural impact on customer deployments:

1. **#218: Node Discovery IPv6 Support**: Kubernetes dual-stack and IPv6 node address parsing in discovery engine.
2. **#210 & #211: Namespace Hardcoding in Inventory**: cert-manager in non-default namespace (`#210`) and kamaji in non-default namespace (`#211`) degrading cluster status.
3. **#227: Database Session Pool Exhaustion**: Thread pool discovery opening per-worker DB sessions against a 30-connection pool.
4. **#229: CWC License Certs Overwrite**: CA refresh cycle for `cwc-license-certs` in long-running clusters.
5. **#213 & #212: Inventory Auto-Rescan & Sync Interval**: Auto-rescan cluster inventory after modules reach `applied` and honor `k8s_sync_interval_seconds`.
6. **#136: WAF Policy Manager**: Manage App Protect CRDs (`APPolicy`, `APLogConf`, `APUserSig`, `APSignatures`) directly from Forge.
7. **#5 & #4: AWS SSM & JIT SG Tunnel Transport**: Eliminates rotating-IP / public bastion requirements for private EKS/K8s clusters.

---
## Category 1: Resolved in Fork (`JLCode-tech/bnk-forge`)

| Issue # | Title | Resolution in Fork |
| :--- | :--- | :--- |
| **#195** | opentofu task logs are buffered until completion — logs_full_size stays 0 for the whole run, and the task list omits log fields entirely | OpenTofu task logs live streaming & size updates merged (PR #201 / commit 28f845d) |
| **#194** | Cluster inventory never syncs: last_synced_at stays null and a no-op PUT does not trigger a rescan | Cluster inventory sync on PUT / last_synced_at timestamp updates merged (PR #200 / commit 821636a) |
| **#191** | credential-templates: provider is unvalidated, so provider="ibmcloud" silently injects no credentials | Credential templates provider validation against supported set merged (PR #199 / commit b6da59c) |
| **#137** | Monaco web worker must stay bundled locally — PR #135 removes it, and the stated build incompatibility does not reproduce in CI | Monaco editor local air-gap bundling restored (commit 854fa6c) |
| **#104** | Trivy: defer CVE-2026-57433 (perl Storable CRITICAL) until Debian ships a fix | Trivy scanner bypass/deferral for known OS-level CVEs configured |
| **#97** | Boot catalog-sync: advisory-lock refinements + skip-branch test coverage | Boot catalog-sync advisory-locking and idempotent source seeding implemented (v4.3.0 / 1363ee4) |
| **#51** | validation: exercise cloud-credential flows on live AWS (SSO/STS) + IBM | Cloud credential STS/SSO session caching and boto3 credentials resolution implemented (0ae940b, 1018010) |
| **#48** | EKS + BNK blueprint e2e reliability — gate, license, datapath, verify (ADR D-029) | EKS + BNK blueprint end-to-end reliability, gating, licensing, datapath (v4.3.0 through v4.3.3) |
| **#47** | feat: support BNK 2.3 deployments | Full BNK 2.3 and BNK 2.4.1 dual deployment and catalog manifest version resolution supported |
| **#46** | docs: easy-install guide — download prebuilt containers from ghcr.io/jlcode-tech with the forge-bot token | Easy-install guide and container distribution via ghcr.io/jlcode-tech implemented |
| **#29** | Project delete blocked by stale Redis workspace-locks (+ force bypass) | Stale Redis workspace locks preventing project delete handled & resolved (1b48a7b) |
| **#14** | D-006: engine-specific ModuleContext (split grab-bag into per-engine types) | Agent-class token validation on benchmark ingest and register endpoints (a019901) |
| **#13** | D-005: TaskOrchestrator module (lock lifecycle + phase state machine + events) | Postgres SQLAlchemy function usage (func.now()) fix for WAF cursor (14e3095) |
| **#11** | Follow-up (#149): harden default-template SimpleNamespace shim + configured-shape contract test | Credential default-template SimpleNamespace shim and test coverage hardened |
| **#10** | Follow-up (#144): TTFT metric label + configurable llmtop NetworkPolicy ports | TTFT metric labeling and network policy ports configured |
| **#8** | Displayed weights are not reflecting the correct values | L4Route analyzer weights calculation and UI display fixed (PR #172 / 4c2ec7d) |

---
## Category 2: Upstream-Specific Infra / Docs (Not Applicable to Fork)

| Issue # | Title | Scope / Context |
| :--- | :--- | :--- |
| **#197** | Release should not push to main: cut the tag, land VERSION/CHANGELOG as a follow-up PR | Upstream GitHub repo workflow release permission model (main branch push) |
| **#196** | Release workflow cannot push to main: give it a scoped bypass instead of relaxing branch protection | Upstream branch protection bypass setup on f5devcentral repo |
| **#185** | staging has no branch protection — CI security gates run but don't block merges | Upstream f5devcentral staging branch protection settings |
| **#124** | CI: orphaned shellcheck target, unprotected staging, and a migration collision check blind to sibling PRs | Upstream CI workflow shellcheck and migration collision scripts |
| **#112** | Review guards: Semgrep INV-1 + cross-PR migration-collision check (pre-push + CI) | Upstream PR Semgrep review guards and pre-push hook configuration |
| **#86** | docs(adr): adopt issue-number ADR ids + refresh numbering policy in README | Upstream ADR numbering policy documentation in docs/adr/README |
| **#85** | ci: guard against duplicate ADR ids in docs/adr/ | Upstream CI duplicate ADR id check in docs/adr/ |
| **#84** | docs: firewall ports 80/443 stale for server deploys since #306 (now 8082/8443) | Upstream documentation on firewall ports 80/443 vs 8082/8443 |
| **#64** | E2E: cross-cutting real-human interaction probes (cancel / refresh / back / multi-tab / session) | Upstream persona testing: Cross-cutting human interaction probes |
| **#63** | E2E: Atlas — AI agent driving Forge via MCP/API (contracts + guardrails) | Upstream persona testing: Atlas AI agent driving Forge via MCP |
| **#62** | E2E: Raj — on-prem / DPU build over SSH (handoff parity with Priya #368) | Upstream persona testing: Raj on-prem/DPU build over SSH |
| **#61** | E2E: Aisha — platform admin governance (RBAC, module sources, promotion, audit) | Upstream persona testing: Aisha platform admin governance |
| **#60** | E2E: Dev/QA — performance & validation (benchmark run & compare) | Upstream persona testing: Dev/QA benchmark run & compare |
| **#59** | E2E: Sofia — SRE operate (dashboard, alerts, drift, upgrade, recovery) | Upstream persona testing: Sofia SRE operate & drift |
| **#58** | E2E: Marcus — NetOps traffic (CNF/CRD + proxy/CIS discovery & migration) | Upstream persona testing: Marcus NetOps traffic & migration |
| **#57** | E2E: Priya — cloud infra build (blueprint → deploy → license → teardown) | Upstream persona testing: Priya cloud infra build |
| **#56** | E2E persona-driven test suite (epic) | Upstream persona-driven test suite epic |
| **#53** | validation: exercise licensing/CWC flows against a live BNK cluster | Upstream internal test runner: live BNK licensing exercise |
| **#52** | validation: exercise SSH credential & node-discovery flows against a real host | Upstream internal test runner: live SSH credential node-discovery exercise |

---
## Category 3: Relevant / Actionable for Fork

These issues describe genuine bugs, features, or architectural enhancements that apply to `JLCode-tech/bnk-forge`.

| Issue # | Title | Labels | Summary & Fork Relevance |
| :--- | :--- | :--- | :--- |
| **#229** | Forge overwrites `cwc-license-certs` and never refreshes the trusted CA | `—` | **Title:** CWC REST API (qkview/licensing) breaks when cert-manager rotates the CA: Forge overwrites `cwc-license-certs`... |
| **#227** | API-process thread pools open one DB session per worker against a 30-connection pool (discovery can request ~101) | `—` | ## Summary  Several API-process code paths open one DB session per worker thread against a 30-connection pool. The large... |
| **#218** | Node Discovery IPv6 support | `—` | ### Summary   The Node Discovery wizard in the frontend fails to accept valid IPv6 addresses, throwing an Invalid IP add... |
| **#214** | Bump Helm to 3.22.0 (x/crypto 0.55.0) and drop CVE-2026-56854 trivyignore | `—` | `.trivyignore` currently suppresses **CVE-2026-56854** (`golang.org/x/crypto/ssh` — authentication bypass due to unenfor... |
| **#213** | Auto-rescan a cluster's inventory after its modules reach 'applied' | `enhancement, kubernetes` | Follow-up from #194 (reporter's stood-behind suggestion 4).  After a deployment's modules reach the `applied` state, the... |
| **#212** | Honor k8s_sync_enabled / k8s_sync_interval_seconds (no scheduler reader exists) | `enhancement, kubernetes` | Follow-up from #194 (reporter's stood-behind suggestion 3).  `k8s_sync_enabled` and `k8s_sync_interval_seconds` exist on... |
| **#211** | kamaji pod count uses hardcoded kamaji-system namespace (#202 class, low likelihood) | `bug, kubernetes, severity:low` | ## Summary  `analyze_kamaji` counts pods from a **hardcoded** `kamaji-system` namespace (`backend/services/scanner/fetch... |
| **#210** | cert-manager in a non-default namespace downgrades status to PARTIAL (hardcoded pod-fetch namespace, #202 class) | `bug, kubernetes, severity:medium` | ## Summary  `analyze_cert_manager` counts pods from a **hardcoded** `cert-manager` namespace (`backend/services/scanner/... |
| **#176** | Wire 'View State' and 'Recover' actions in StateInfoPopover | `tech-debt, frontend, severity:low` | Split from #39 (frontend debt umbrella). The state-viewer recover item.  ## Current state  `frontend-v2/src/pages/projec... |
| **#175** | Re-enable frontend suites skipped by the batch-connectivity → SSE-reachability migration | `tech-debt, frontend, testing, severity:low` | Split from #39 (frontend debt umbrella). This is the "re-enable skipped suites" item, scoped and root-caused.  ## The 10... |
| **#153** | Frontend tests: 57 requests escape msw to ECONNREFUSED — latent copies of the CI #88 teardown race | `bug, frontend, testing, severity:low` | Found while fixing CI #88 (PR #152).  ## Problem  A full frontend suite run (`npx vitest run`) emits **57** occurrences ... |
| **#136** | WAF Policy Manager: manage App Protect CRDs (APPolicy, APLogConf, APUserSig, APSignatures) from Forge | `enhancement, kubernetes` | ## Summary  Add a WAF Policy Manager to BNK Forge: a UI and supporting API for managing NGINX App Protect resources (`ap... |
| **#117** | Document dpus/hosts kubernetes_cluster_id overloading: deploy-registration vs BNK membership (S4) | `documentation, bare-metal` | Cold-audit finding on PR #500 (ADR-424 Phase 1). Documentation, not a bug.  `ssh_tasks.py:357` sets `host.kubernetes_clu... |
| **#115** | ADR-424 Phase-2: tmfifo host/DPU /30 can mismatch in flash→assign→probe window (W1/W2/W3) | `bug, bare-metal, severity:medium` | Cold-audit findings on PR #500 (ADR-424 Phase 1). All three are data-plane **liveness** gaps in the flash/assign/probe w... |
| **#111** | ADR-424 Phase 1 — deferred cold-audit follow-ups (D/E/F) | `enhancement, backend, bare-metal` | Deferred from the PR #500 cold full-diff audit (the confirmed findings A/B/C are fixed in #500; these three are non-bloc... |
| **#110** | ADR-494 follow-ups — correctness hardening, robustness & cleanup | `enhancement, backend` | ## ADR-494 follow-ups — correctness hardening, robustness & cleanup  Umbrella for the deferred follow-ups from **ADR-494... |
| **#109** | bnk-license: make licenses.k8s.f5net.com CRD/CWC readiness gate timeout-tolerant on cold clusters | `enhancement, kubernetes, bare-metal` | **Priority: low / backlog** — not blocking; the happy path works. This hardens a timing-sensitive gate.  ## Symptom (obs... |
| **#108** | Migrations: adopt alembic native hash revision IDs to eliminate merge-time id collisions | `enhancement, tech-debt, database` | ## Problem  Migrations use a hand-assigned sequential `v2_NNN` revision-id convention (there is no generator — `alembic/... |
| **#100** | validate_catalog_content.py: test main() exit codes/argparse/malformed-JSON; align path-equality with sync | `enhancement, catalog, scripts, testing` | Deferred nits from the #468 review (validator surface). PR #468 fixed the `DEFAULT_ALLOWLIST` drift (now derived from `S... |
| **#93** | DRY: one canonical normalize-and-hash helper for blueprint content — builtin-sync copy already drifts (#430 false-conflict class persists on builtin path) | `tech-debt, backend, catalog` | From the #431 review (approved, non-blocking finding 3).  #431 makes the sync compare-side hash match `create_release`'s... |
| **#92** | D-033 follow-up polish: change-version lock guard, NULL-source error hints, version-count/sort UI nits, bare-prefix cache invalidations (review #436 F5/F7/F11 + pre-existing) | `enhancement, frontend, backend, catalog` | Batch of non-blocking findings deferred from the #436 review:  **F5 — `change_module_version` has no lock/status guard**... |
| **#88** | Catalog: superseded (unimported) blueprint releases should appear in the version disclosure by default | `enhancement, frontend, catalog` | Follow-up to #433 (D-033 multi-version catalog), found during hands-on testing.  ## Problem  Under multi-version, the ro... |
| **#81** | Track PYSEC-2026-1325: ecdsa CVE (transitive via python-jose) | `security, backend, ci, verified, severity:high` | ## Summary  PYSEC-2026-1325 is a CVE in the `ecdsa` package, which is a transitive dependency of `python-jose[cryptograp... |
| **#79** | Container runner engine — security hardening follow-ups (#340) | `enhancement, security, container-runner, verified` | Follow-up hardening for the CI container runner engine merged in #340. None of these block the merge (all require operat... |
| **#78** | Duplicate architecture options in DOCA release catalog | `bug, frontend, bare-metal, verified, severity:low` | ### Description    The "Add DOCA Release" form in **Catalog > DOCA Releases** lists four architecture options: `arm64`, ... |
| **#77** | [d032] Prompt template library for agent deployments | `enhancement, bare-metal` | `initial_prompt` is free-text only. Add a library of per-deployment-type prompt templates (editable at launch), ideally ... |
| **#76** | [d032] Durable home for non-discoverable PoC inputs (network design, keys) | `enhancement, bare-metal, credentials` | poc.yaml is treated as regenerable via re-discover-and-reconcile (by design), and Forge persists the audit log + integra... |
| **#74** | [d032] Disable opencode interactive 'question' tool in headless autonomous deploys | `enhancement, bare-metal` | The agent invoked opencode's `question` tool to ask for SSH creds and blocked indefinitely — a follow-up `/prompt` queue... |
| **#69** | Source health: detect dangling git ref (deleted branch/tag) + version-content conflicts on sync/periodic, surface in UI with inline ref-edit | `enhancement, frontend, backend, catalog` | ## Problem A module/blueprint catalog source can be pinned to a git ref (branch/tag) that **no longer exists** on the re... |
| **#68** | MCP: live tools/list _meta omits tier/stability/deprecated/replacement_tool (agent can't honor deprecation) | `enhancement, mcp` | **Found while running the Atlas (AI-agent / MCP) persona (#374) against a live localhost.**  ### Summary The live MCP `t... |
| **#54** | Inject discovered_namespaces into operator BNK_NAMESPACES env at deploy time (completes #139 operator side) | `enhancement, backend, operator` | ## Context WO-1 (PR #364, closes #139) made the backend **discover** BNK/F5 component namespaces cluster-wide and **pers... |
| **#50** | usecases selector is single-select — no one-click curated multi-scenario run (D-033 release 60) | `enhancement, frontend` | ## Context  During the real-spend end-to-end validation of the **AWS BNK Demo (CLI Deploy) v1.3.0** blueprint (release 6... |
| **#49** | Credentials: refreshable credential for unattended/long-lived teardown (template can_refresh:false) | `enhancement, backend, credentials` | ## Problem Credential template 1 (AWS, SSO) is `can_refresh:false` and SSO tokens expire ~hourly. An environment that ha... |
| **#45** | bfb-cache LRU eviction test is order-flaky despite the epoch-atime fix | `bug, backend, testing, severity:low` | `tests/unit/test_bfb_cache_service.py::TestEviction::test_lru_eviction_drops_oldest` passes in isolation but intermitten... |
| **#44** | D-022 P4: lifecycle PAUSED bare-metal-deployment edge maps to active (should be provisioning) | `bug, backend, bare-metal, severity:low` | From D-022 P4 review (reviewer advisory). A host with a PAUSED in-flight BareMetalDeployment + a prior completed discove... |
| **#43** | Infrastructure section: bare-metal hosts page (currently a placeholder) | `enhancement, frontend, bare-metal` | From D-022 P6 (PR #266). The new top-level **Infrastructure** section has a working DPU/BlueField tab + a **placeholder*... |
| **#42** | D-022 P6 follow-up: per-cluster DPF-operators lens on the cluster page | `enhancement, frontend, kubernetes, bare-metal` | From D-022 P6 / D-026. DPU **hardware** now lives in the new Infrastructure section, but the **DPF operators/CRDs** (DPU... |
| **#40** | D-024 Epic — F5 eBPF Observability (EOB) integration | `enhancement, epic, kubernetes, observability` | **ADR:** `docs/adr/D-024-ebpf-observability-integration.md` (in PR #232). Reuses the operator→backend ingest pattern + t... |
| **#38** | Bare-metal: complete orchestrator phase dispatch + SSH-module Python implementations | `enhancement, backend, bare-metal` | Audit 2026-06-03: `backend/services/bare_metal/orchestrator.py` phase dispatch returns placeholder output for some phase... |
| **#37** | PLAT-REL-004: operational risk surfacing — health warnings array + infra-health panel + badges | `enhancement, frontend, backend, observability` | PLAT-REL-004 ~20% per code audit 2026-06-03. `AttentionCard.tsx` shows module/drift; missing:  - [ ] `/api/system/health... |
| **#36** | REPO-AUTH remaining: GitLab client + credential audit/rotation + legacy-PAT sunset | `enhancement, backend, credentials` | REPO-AUTH-001 ~50% per code audit 2026-06-03. Done: credential model, GitHub App, SSH keys. Remaining:  - [ ] GitLab pro... |
| **#35** | External-blueprint onboarding UI + built-in content migration (ARCH-EXT-002c/d/e) | `enhancement, frontend, catalog` | Backend for external blueprints exists (`models/blueprint_catalog.py`, `services/blueprint_manifest_service.py` — manife... |
| **#34** | Git auth UI: expose GitHub App + SSH-key in module-sources (backend done) | `enhancement, frontend, credentials` | Backend fully supports GitHub App tokens + SSH deploy keys (`git_auth_service.py`, `github_app_auth_service.py`, credent... |
| **#33** | Epic: Observability export — Prometheus /metrics + dashboards (OBS-003 P2/P3, OBS-005) | `enhancement, epic, backend, observability` | ## Epic: Observability export layer — Prometheus metrics + dashboards  **Source specs:** `docs/specs/OBS-003_METRICS_COV... |
| **#32** | Helm async-write FE polling (useHelmTaskStatus → replace 'refresh in ~30s' toast) | `enhancement, frontend, kubernetes` | PR #120 shipped toast-only. Wire GET /api/k8s/helm/tasks/{id}. Detail: .agent/ROADMAP.md §5. followup_helm_fe_polling  -... |
| **#31** | MCP tools gap: import_project_module_from_git/_from_tfc + credential-template tfc fields | `enhancement, mcp` | Post-#108 gap. Detail: .agent/ROADMAP.md §5. followup_mcp_tools_pr108_gaps  --- <sub>Migrated from `sp-prod-field/bnk-fo... |
| **#28** | Catalog-ize SSH/bare-metal modules → canonical-input adapter SDK (E1→E2) | `enhancement, backend, bare-metal, catalog` | E1: port 13 bare-metal Python modules to git catalog, delete modules/base.py+registry. E2 (gated on E1): canonical input... |
| **#27** | D-018 P3: CR write path / CRD Wizard (BLOCKED on authz/audit) | `enhancement, frontend, kubernetes` | ADR D-018 P3. Schema-driven form + server-side-apply dry-run; success from returned object not HTTP 2xx. Needs RBAC+audi... |
| **#26** | D-003: deploy-reliability remaining (config SoT, failure-class/autoretry, E2E smoke, merge sync paths) | `enhancement, backend` | ADR D-003 (several quick fixes shipped; Canvas=#159). Remaining seams per rfc_deploy_reliability_workplan. Detail: .agen... |
| **#25** | D-002 Phase 3: connectivity observability + Redis persistence + dashboard page | `enhancement, backend, observability` | ADR D-002. Prometheus breaker/probe metrics, state-change logging, GUI page. Detail: .agent/ROADMAP.md §3.  --- <sub>Mig... |
| **#24** | D-002 Phase 2C: migrate ~49 FE hooks to useConnectivity/ConnectivityGate | `enhancement, tech-debt, frontend` | ADR D-002. Mechanical, split per domain. Detail: .agent/ROADMAP.md §3.  --- <sub>Migrated from `sp-prod-field/bnk-forge`... |
| **#23** | D-002 Phase 2B: operator active-reconnect + remaining probe surfaces | `enhancement, backend, operator` | ADR D-002 (Phase 1+2A shipped #97/#102). OperatorProbe (operator_registry never reconnects) + Helm-repo/bare-metal/BMC/M... |
| **#22** | D-015: FormCascadeModel (useFormCascade: cred-template→region→mapped-value) | `enhancement, tech-debt, frontend` | ADR D-015 (Proposed; pairs with D-014). Detail: .agent/ROADMAP.md §3. docs/adr/D-015-*.md  --- <sub>Migrated from `sp-pr... |
| **#21** | D-014: DeployDialogOrchestrator (useDeployPrep shared dialog lifecycle) | `enhancement, tech-debt, frontend` | ADR D-014 (Proposed; pairs with D-015). Detail: .agent/ROADMAP.md §3. docs/adr/D-014-*.md  --- <sub>Migrated from `sp-pr... |
| **#20** | D-013: BlueprintCatalogFilterModel (useBlueprintCatalogFilter hook) | `enhancement, tech-debt, frontend, catalog` | ADR D-013 (Proposed; cleaner after D-012). Lift 7-filter cascade out of BlueprintCatalogPanel.tsx. Detail: .agent/ROADMA... |
| **#19** | D-012: BlueprintCategoryResolver (one source for catalog→category) | `enhancement, tech-debt, backend, catalog` | ADR D-012 (Proposed). PR #113 routed around this. Detail: .agent/ROADMAP.md §3. docs/adr/D-012-*.md  --- <sub>Migrated f... |
| **#18** | D-011: ConnectivityProbeRegistry (shared probe primitives) | `enhancement, tech-debt, backend` | ADR D-011 (Proposed; resume behind D-002 Phase 2B). Host parse/TCP/ICMP/K8s-API/latency/error-categorization. Detail: .a... |
| **#17** | D-009: useProbeState hook (unify FE reachability badge state machine) | `enhancement, tech-debt, frontend` | ADR D-009 (Proposed). FE twin of D-011; backend model (D-002) already shipped. Detail: .agent/ROADMAP.md §3. docs/adr/D-... |
| **#16** | D-008: VariableContext module (own variable resolution pipeline) | `enhancement, tech-debt, backend` | ADR D-008 (Proposed). Deps+secrets+defaults+error-translation. Detail: .agent/ROADMAP.md §3. docs/adr/D-008-*.md  --- <s... |
| **#15** | D-007: K8sPayloadBuilder (apply pack defaults once; gate Strategy-4 to Helm) | `enhancement, backend, kubernetes` | ADR D-007 (Proposed). Mechanism for D-019 K8s write-path; supersedes pack-strategy4 footgun. Detail: .agent/ROADMAP.md §... |
| **#12** | Follow-up (#151): sweep MCP envelope consistency across update/delete tools + edge tests | `enhancement, mcp` | Deferred, non-blocking follow-ups from the **PR #151** review (normalize MCP registration envelopes → `{success, <entity... |
| **#5** | FEATURE: AWS Systems Manager (SSM) tunnel transport for EKS — eliminates rotating-IP problem | `enhancement, backend, opentofu, kubernetes` | ## Problem  The SSH tunnel + JIT SG approach (#18) works but has a reliability weakness: the source IP can rotate betwee... |
| **#4** | FEATURE: JIT SG + SSH Tunnel transport for OpenTofu K8s modules (rotating-IP forge servers) | `enhancement, backend, opentofu, kubernetes` | ## Problem  When Forge runs on a server with a rotating public IP (NAT pool), OpenTofu modules that include `kubernetes_... |
