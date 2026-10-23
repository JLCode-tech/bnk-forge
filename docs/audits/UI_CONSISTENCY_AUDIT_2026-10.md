# UI Consistency Audit & Remediation Plan — frontend-v2

| | |
|---|---|
| **Date** | 2026-10-12 |
| **Branch audited** | `test/v4-with-azure-auth` @ `b657812` (plus uncommitted working-tree changes) |
| **Environment** | Local docker stack, `https://localhost/` (proxy → `bnk-forge-frontend:8080`), logged in as `admin` |
| **Scope** | `frontend-v2/src` only. No backend changes are needed for anything in this plan. |
| **Status** | Audit complete. **Nothing remediated yet.** This document is the implementation brief. |

---

## 0. Read this first (instructions for the implementing agent)

1. **Follow `AGENTS.md` and `docs/DEVELOPMENT.md`.** In particular: fix in place, no `_v2` components or parallel implementations, surgical diffs, match surrounding style.
2. **Many relevant files are untracked** on this branch, so `git grep` will **not** find them. Use `grep -rn` / `rg`. The untracked files include:
   `hooks/useClusterScope.ts`, `pages/CRExplorer.tsx`, `pages/ai/AgentFleetPage.tsx`, `pages/ai/SmartLlmRouterPage.tsx`, `pages/ai/ClusterRouterRow.tsx`, `components/fleet/FleetClusterPicker.tsx`, `components/fleet/ClusterResourcePicker.tsx`, `components/k8s/epp/EPPRealtimeDashboard.tsx`, `pages/InferenceXRunDetail.tsx`, `pages/BenchmarkCurvesView.tsx`, `pages/cnf-parts/*`.
3. **Line numbers were taken at audit time** and will drift. Treat them as anchors; re-locate them with grep before you edit.
4. **Work one phase per PR**, in the order given in §6. Phase 1 fixes a real behaviour bug and goes first.
5. **Each phase has acceptance criteria.** Don't call a phase done until they pass, including the live crawl in Appendix A.
6. Per `docs/ROADMAP_PROCESS.md`: write the ADR (§5) before the first PR, open one GitHub issue per phase, then link the PRs to those issues.
7. **Commit hygiene:** Conventional Commits. Never put a literal CI-skip marker in any commit message.

---

## 1. Executive summary

Users report different fonts, inconsistent cluster and project dropdowns, and inconsistent page layouts. There are four root causes:

| # | Root cause | User-visible effect |
|---|---|---|
| R1 | **No app-wide scope state.** Every page keeps its own cluster, project and namespace selection, using 7 different persistence schemes. | Dropdowns look and behave differently on each page. Selection is lost or wiped between pages. Deep links work on some pages only. |
| R2 | **Shared layout primitives are only partly adopted.** About a third of pages hand-roll their wrapper and header. | Titles jump position (x=24 vs x=56) and size (20px vs 24px). The header bar title disagrees with the page title. Tabs, cards and empty states all look different. |
| R3 | **No typography rules.** `font-mono` is used 843 times as general UI text, faux bold is applied to mono, and there are 708 arbitrary pixel font sizes. | Pages "look like different fonts": AI and Benchmark pages are majority-monospace, while ops pages have none. |
| R4 | **Primitive bypass.** Raw `<select>`, `<table>` and `<button>` elements, 48 separate status-colour mappers, and copy-pasted chart themes. | The same status shows different colours. Table headers and form controls differ between pages. |

Only two font families are ever loaded: **Inter** and **JetBrains Mono**. No page loads a different typeface. The "different fonts" complaint comes entirely from R3.

---

## 2. Method

1. **Live crawl.** Headless Chromium (Playwright) logged in at `https://localhost/` with a 1600×1000 viewport and visited every sidebar route plus a project detail page. For each page it measured:
   - computed font-family counts for text-bearing elements inside `<main>`
   - computed font-size distribution
   - h1/h2 size, weight and family
   - title offset relative to `<main>`
   - the outer wrapper's classes
   - the size and position of every combobox or `<select>`

   It also took screenshots. The script is in Appendix A so you can re-run it as the verification step.
2. **Static audit** of `frontend-v2/src`, in three passes: (a) scope pickers and state, (b) page layout primitives, (c) typography, colour tokens and primitive bypass. Counts exclude `__tests__`, `*.test.*` and `*.spec.*`.

---

## 3. Live measurements (ground truth)

`main` is 1344px wide at a 1600px viewport, and `AppShell` applies **no padding** to `<main>` (`components/layout/AppShell.tsx:72`).

| Route | Header-bar title (`Header.tsx`) | Page h1 | h1 size | Title offset | Wrapper | Fonts (Inter : Mono) | Scope picker(s) observed |
|---|---|---|---|---|---|---|---|
| `/` | Command Center | Good afternoon | 24px/700 | x=56 | `p-6 space-y-6 max-w-7xl mx-auto` | 89 : 48 | — |
| `/projects` | Projects | Projects | 24 | x=56 | std | 96 : 17 | — |
| `/projects/29` | **Infrastructure Management** (fallback) | aws-build-demo | 24 | **x=24 y=48** | full-bleed `min-h-screen` | — | — |
| `/catalog` (and `/modules` →) | **Infrastructure Management** (fallback) | Catalog | 24 | x=56 | std | 232 : 29 | shadcn Select 203×40 ("All Platforms", "All Sources") |
| `/tasks` | Operations Log | Operations Log | 24 | x=56 | std | 19 : 0 | **native `<select>`** 277×36 "All projects" |
| `/kubernetes` (and `/helm` →) | Kubernetes | Kubernetes | 24 | **x=24** | `h-full flex flex-col` | 51 : 0 | shadcn 180×36 "All Projects", 200×36 "All Clusters", namespace "default" |
| `/crds` | Custom Resources | Custom Resources | 24 | x=24 | REL | 7 : 0 | 180×36 "All Projects", **200×36 "Select Cluster" (disabled)**, "All Namespaces" |
| `/bnk` | F5 BNK | F5 BNK | 24 | x=24 | REL | 51 : 0 | 180/200/180 ×36, "All Clusters", "All Namespaces" |
| `/cnf` | F5 CNF | F5 CNF | 24 | x=24 | REL | 36 : 0 | 180/200/180 ×36, "All Clusters", "All Namespaces" |
| `/stacks` | **Infrastructure Management** (fallback) | Blueprints | 24 | x=56 | std | 40 : 4 | — |
| `/auth-templates` | **Infrastructure Management** (fallback) | Access Methods | 24 | x=56 | std | 75 : 2 | shadcn 192×40 "All Providers" |
| `/system` | System | System Administration | 24 | x=56 | std | 69 : 1 | — |
| `/fleet` (and `/operators` →) | **Infrastructure Management** (fallback) | Fleet | 24 | x=56 | std | 95 : 3 | (pickers inside dialogs) |
| `/infrastructure` | **Infrastructure Management** (fallback) | Infrastructure | 24 | x=56 | std | 14 : 0 | **native `<select>` 240×33**, in page body, no "All" option |
| `/benchmarks` | Benchmarks | **Performance Benchmarks** | 24 | x=56 | std | 72 : **57** | `ClusterPicker` **220×32** "All Clusters" (header right) |
| `/ai/agents` | Agent Fleet & Identity | Agent Fleet & Identity | **20px** | x=24 | `space-y-6 p-6` (no max-w) | **38 : 43** (majority mono) | `ClusterPicker` 220×32 |
| `/ai/governance` = `/observability/ai-gateway` | Token & Cost Governance | **Token Intelligence** | **20px** | x=24 | `space-y-6 p-6` | 99 : 7 | `ClusterPicker` 220×32, plus model 160×32, time range, status 130×32 |
| `/ai/routing` | SmartLLM Traffic Router | SmartLLM Traffic Router | **20px** | x=24 | `space-y-6 p-6` | 61 : 4 | `ClusterPicker` 220×32 |
| `/ai/logs` | Request Audit Logs | **LLM Logs** | **20px** | x=24 | `space-y-5 p-6` | 308 : 105 | `ClusterPicker` 220×32, model, status |
| `/users` | **Infrastructure Management** (fallback) | User Management | 24 | x=56 | std | 30 : 0 | — |
| `/mcp-server` → `/system?tab=mcp` | System | System Administration | 24 | x=56 | std | 45 : 1 | — |

Observations visible directly in the screenshots:
- **Infrastructure:** the cluster dropdown is a browser-native `<select>` with an uppercase "CLUSTER" label, and it looks nothing like any other picker.
- **Operations Log:** native `<select>` for project, with lower-case "All projects".
- **Agent Fleet:** table cells, KPI numbers ("1 Throttled") and badges are all JetBrains Mono. KPI numbers look faux-bold.
- **Token Governance:** uses pill-style `TabsList` tabs, whereas Benchmarks, Infrastructure and System use the underline `ResourceViewTabs`.
- **Benchmarks:** the "SCOPE: All Clusters" chip is mono, and the KPI values are mono with sans units.
- **Project detail:** the breadcrumb reads "Home / Infrastructure Management", and the content is left-aligned and full-bleed.

---

## 4. Detailed findings

Severity: **S1** = functional bug, **S2** = visible inconsistency on a primary flow, **S3** = cosmetic or debt.

### 4.1 Cluster / project / namespace scope (R1)

There is no global scope. `uiStore` has no scope slice, there is no React context, and `Header` has no picker. The only shared thing is one localStorage key, `bnk-forge-cluster-scope` (`lib/storage-keys.ts:12`), which every page reads and writes in its own way. Project scope is **per page**.

#### F-1.1 (S1) Visiting one page wipes the shared cluster scope for every page
- `lib/storage-keys.ts`: `K8S_CLUSTER`, `BNK_CLUSTER` and `CNF_CLUSTER` are all **aliases** of `CLUSTER_SCOPE`.
- `K8S_PROJECT`, `BNK_PROJECT` and `CNF_PROJECT` are **separate** keys.
- `pages/CNF.tsx:95-102`: if the selected cluster isn't in CNF's own selected project, the page calls `setSelectedCluster(null)` and `localStorage.removeItem(STORAGE_KEYS.CNF_CLUSTER)`. That removes the **shared** key.
- `pages/F5BNK.tsx:805-813`: the same pattern. It resets the cluster when the cluster isn't in BNK's own project.
- **Repro:** on `/kubernetes`, choose project A and cluster X. On `/cnf`, have project B selected (stored separately). CNF clears X. Go back to `/kubernetes` and the cluster is gone.
- **Root cause:** cluster scope is shared but project scope isn't.

#### F-1.2 (S2) Two competing cluster picker components plus three native selects

| ID | Implementation | Location | Primitive | Size | Placeholder | "All" option | Loading/empty | State |
|---|---|---|---|---|---|---|---|---|
| A | Project select in `ResourcePageHeader` | `components/layout/ResourcePageHeader.tsx:109-144` | shadcn Select | `w-[180px] h-9`, LayoutGrid icon | "All Projects" | always | none | props |
| B | Cluster select in `ResourcePageHeader` | `ResourcePageHeader.tsx:152-205` | shadcn Select | `w-[200px] h-9`, status dot | "Select Cluster" | `allowAllClusters` (default **false**) | "No clusters found"; disabled if empty | props |
| C | Namespace select in `ResourcePageHeader` | `ResourcePageHeader.tsx:210-237` | shadcn Select | `w-[180px] h-9 font-medium` | "All Namespaces" text | "all" deliberately hidden from list | disabled without cluster | props |
| D | `ClusterPicker` | `components/observability/pickers.tsx:23-57` | shadcn Select | `h-8 w-[220px] text-xs`, Box icon | "Select cluster…" | `allowAll` (default **true**) | **none** | fetches `useAllClusters()` internally |
| E | `TimeRangePicker` | `components/observability/TimeRangePicker.tsx:31` | shadcn Select | `h-8 w-[150px] text-xs` | — | — | — | URL `?range` |
| F | DPU cluster | `components/infrastructure/DpuInfrastructurePanel.tsx:41-51` | **native `<select>`** | `min-w-[240px] py-1.5 text-sm` | label "CLUSTER" | **none**, silently uses the first cluster (`:28`) | Skeleton, "No clusters available" | local `useState` |
| G | Project filter on Tasks | `pages/TaskHistory.tsx:411` | **native `<select>`** | `h-9 px-3 text-sm` | "All projects" (lower-case) | yes | none | local |
| H | `FleetClusterPicker` | `components/fleet/FleetClusterPicker.tsx:33` | custom checkbox tree | — | grouped by project, multi-select | n/a | Skeleton | local |
| I | Fleet compare A/B; `ConfigPromotionWizard` | `pages/Fleet.tsx:581,596`; `ConfigPromotionWizard.tsx:254,281` | **native `<select>`** | `flex-1 px-3 py-2` | "Select cluster A…", "Select source cluster..." (values are operator IDs) | no | none | local |
| J | Benchmark target forms | `pages/BenchmarkTargetsTab.tsx:665-676, 786-797` | shadcn Select | full width, Label above | "Select a cluster" | no | placeholder only | own `useAllClusters` (`:160`); status shown as a "(status)" suffix |
| K | Benchmark target and agent pickers | `BenchmarkTrendsView.tsx:105` (`w-56`); `RunBenchmarkWizard.tsx:338,428` (unsized) | shadcn Select | mixed | "Select a target", "Select a connected agent" | no | none | own hooks |

B and D differ in height (36 vs 32), width (200 vs 220), text size, icon, placeholder wording, the default for "All", empty-state handling and status dots.

#### F-1.3 (S2) Seven different persistence schemes for cluster scope

| # | Scheme | Pages |
|---|---|---|
| 1 | URL `?cluster` → effect writes the shared key | Kubernetes (`KubernetesV2.tsx:373-382`), F5BNK |
| 2 | localStorage only, via direct `STORAGE_KEYS.*` calls | CNF, CRExplorer |
| 3 | URL plus `readClusterScope`/`writeClusterScope`, with `null` meaning "all" (`hooks/useClusterScope.ts`) | Benchmarks (`Benchmarks.tsx:476-485`) |
| 4 | URL with an explicit `all` sentinel (`?cluster=all`) | LlmDashboard, LlmLogs (`use-observability-filters.ts`) |
| 5 | `useClusterScope()` hook, localStorage only, no URL | AgentFleetPage, SmartLlmRouterPage |
| 6 | URL as initial value only, then local `useState`, not persisted | Infrastructure (DPU panel) |
| 7 | No scope | Fleet, Tasks |

#### F-1.4 (S2) "All clusters" means different things on different pages
- Benchmarks and the AI pages store "all" as **removing** the key.
- The next page then applies its own default: CRExplorer auto-picks the first cluster (`CRExplorer.tsx:77-83`), while observability uses `all`.
- Observability puts `cluster=all` in the URL.
- CRExplorer and Infrastructure offer **no** "All" option.

#### F-1.5 (S2) Deep links are inconsistent
- `?cluster=` is honoured by Kubernetes, BNK, Benchmarks, observability and Infrastructure (initial value only). It is **ignored** by CNF, CRExplorer and the AI agents and routing pages.
- `?project=` is honoured only by Kubernetes and BNK.

#### F-1.6 (S2) `useClusterScope` doesn't react to changes
- Each mount has its own `useState`.
- There is no `storage` event listener and no shared store.
- `Benchmarks.tsx:476-481` calls `readClusterScope()` during render, so it is not reactive.

#### F-1.7 (S2) CRExplorer's project and cluster handling differs from its siblings
- It shares `K8S_PROJECT` with Kubernetes (`CRExplorer.tsx:65,260`).
- Its cluster list comes only from `useProjectClusters` (`:69`), so with no project selected the list is empty.
- Because `allowAllClusters` is false, the picker is disabled (`ResourcePageHeader.tsx:167`). This is what the live crawl showed: "Select Cluster" disabled, plus an empty state saying "No project selected".
- Kubernetes, BNK and CNF instead filter `useAllClusters` on the client.

#### F-1.8 (S2) Namespace defaults differ
- Kubernetes: `"default"`, persisted per cluster (`KubernetesV2.tsx:278-289`).
- F5BNK: URL value or `"all"` (`:708`).
- CNF and CRExplorer: `"all"`, not persisted (`CNF.tsx:126`, `CRExplorer.tsx:103`).
- `ResourcePageHeader` deliberately hides "All Namespaces" because a cluster-wide fetch is expensive, yet three pages default to it.

#### F-1.9 (S3) Picker placement differs
- Explorers: a left-aligned sticky bar under the title.
- Benchmarks: `PageHeader` actions, on the right.
- AI and observability: a hand-built header row, on the right.
- Infrastructure: inside the panel body.

#### F-1.10 (S3) Wording differs
- "All Projects" vs "All projects".
- "Select Cluster" vs "Select cluster…" vs "Select a cluster".
- Status is shown as a dot (B), a "(status)" suffix (J), or not at all (D, F).

#### F-1.11 (S3) Dead or stale keys
- `Fleet.tsx:1051,1059` write the literals `"bnk-forge-bnk-cluster"` and `"bnk-forge-k8s-cluster"`, which nothing reads any more.
- `STORAGE_KEYS.HELM_CLUSTER` is unused.
- The `K8S_CLUSTER`, `BNK_CLUSTER` and `CNF_CLUSTER` aliases hide the fact that the key is shared, which is how F-1.1 happened.

#### F-1.12 (S3) Duplicate data hooks
- `hooks/useK8sClusters.ts:29,37` and `hooks/k8s/useClusterCRUD.ts:36,44` **both** define `useAllClusters`, `useProjectClusters`, `useCluster` and the CRUD hooks, with the same query keys.
- `hooks/useK8s.ts` re-exports the `k8s/` copy.
- Imports are split between the two paths. `CNF.tsx:38-39` and `CRExplorer.tsx:31-32` import from **both**.
- Projects:
  - `useProjects()` (`hooks/useProjects.ts:9`, key `["projects","list"]`)
  - vs inline `useQuery({queryKey:['projects']})` in `components/stacks/StackDetailDialog.tsx:409` and `components/stacks/ImportedBlueprintDeployDialog.tsx:65`, which caches the same list twice
  - vs `api.getProjects()` called directly in `hooks/useDeployments.ts:45`

#### F-1.13 (S1) Agent Fleet scope picker sits over sample data
- `AgentFleetPage.tsx:59+` renders hard-coded sample agents. The page shows a "Demo agent registry" badge.
- The `ClusterPicker` very likely filters nothing.
- **Unverified:** confirm whether the picker filters anything.

### 4.2 Page layout (R2)

`AppShell` `<main>` has no padding, so each page supplies its own. Shared primitives:
- `components/layout/PageHeader.tsx`: props `title`, `titleBadge`, `subtitle`, `actions`, `onRefresh`, `isRefreshing`, `className`. Title style is `text-2xl font-bold tracking-tight`.
- `components/layout/ResourcePageHeader.tsx` plus `ResourceExplorerLayout.tsx` (with `.Body`, `.Content` and `.DetailPanel`), for explorer pages.
- `components/layout/ResourceViewTabs.tsx`: `variant: 'strip' | 'inline'`.
- `components/ui/section-card.tsx`: `title`, `action`, `compact`, …
- `components/ui/empty-state.tsx`, `components/ui/error-state.tsx`, `components/ui/skeleton-table.tsx`.
- `hooks/usePageRefresh.ts`.

#### Page matrix

**Std** = `p-6 space-y-6 max-w-7xl mx-auto`; **PH** = PageHeader; **RPH** = ResourcePageHeader; **REL** = ResourceExplorerLayout; **RVT** = ResourceViewTabs; **SC** = SectionCard.

| Page (file) | Wrapper | Header | Title | Tabs | Containers / table | Loading / empty / error |
|---|---|---|---|---|---|---|
| Dashboard | Std | PH | std | — | SC | Skeleton, ErrorState |
| Projects | Std | PH | std | — | SC + **raw `<table>`** (:295) | Skeleton, EmptyState, ErrorState |
| ProjectDetailV2 | **`min-h-screen flex flex-col`** full-bleed (:470) | **hand-rolled h1** in a bordered strip (:482) | 2xl bold tracking-tight | RVT strip (URL `tab`) **plus** a shadcn pill `TabsList grid-cols-6` in the module sheet (:967) | raw `rounded-lg border` divs (:712, :732) | Skeleton with no padding (:452); ad-hoc empty (:873-890) and not-found (:461) |
| Catalog | Std | PH | std | RVT inline, URL | delegated | **Loader2 spinner** (:30-33) |
| TaskHistory | Std | PH | std | — | SC + **raw `<table>`** (:525) | Skeleton, EmptyState, ErrorState |
| Stacks | Std | PH | std | — | SC + **raw `<table>`** (:264) | Skeleton, EmptyState, ErrorState |
| AuthTemplates | Std | PH | std | — | `<h2 text-sm>` (:36) | none |
| System | Std | PH | std | RVT inline, URL | SC | delegated |
| Fleet | Std | PH | std | RVT inline ×2 (:4208, :4851); URL accepts **both** `tab` and `view` (:4775, :4793) | SC ×19 | Skeleton, EmptyState, **no ErrorState** |
| UserManagement | Std | PH | std | — | SC + shadcn Table | Skeleton |
| Benchmarks | Std | PH (custom `handleRefresh`) | std | RVT inline, URL | sub-tabs | EmptyState |
| Infrastructure | Std | PH | std | RVT inline, URL | SC | EmptyState |
| KubernetesV2 | REL | RPH | std | RVT strip, URL `view` | shadcn Table; Card on the landing page (:1090) | SkeletonTable, EmptyState, ErrorState |
| CRExplorer | REL | RPH | std | RVT strip, **`useState` only** (:54) | — | Skeleton, EmptyState, **no ErrorState** |
| F5BNK | REL | RPH; sub-views use `<h2 text-xl font-semibold>` ×13 (:160-458) | std | RVT strip, URL; **custom `tabBtn` pills** in Diagnostics (:148) | shadcn Table; Card (:1359) | SkeletonTable, EmptyState, ad-hoc error |
| CNF | REL | RPH | std | RVT strip, **`useState` only** (:60) | shadcn Table; Card (:334) | **none**: plain text "No clusters found" (:377) |
| LlmDashboard (`pages/observability/`) | `space-y-6 p-6`, **no max-w** (:123) | **hand-rolled h1** (:126) | **text-xl, no tracking** | **shadcn pill `TabsList`** (:242), URL via hook | SC, shadcn Table | Skeleton, ad-hoc text (:943) |
| LlmLogs | **`space-y-5`** `p-6` (:187) | hand-rolled h1 (:190) | **text-xl, no tracking** | — | SC, Table, StatTile | Skeleton in a TableCell; ad-hoc text (:305) |
| AgentFleetPage (`pages/ai/`) | `space-y-6 p-6` (:358) | hand-rolled h1 (:363) | **text-xl** tracking-tight | shadcn Tabs **restyled as underline**, text-xs, uncontrolled `defaultValue` (:481-507) | Card + CardContent p-4 KPI tiles | "…" text only |
| SmartLlmRouterPage | `space-y-6 p-6` (:49) | hand-rolled h1 (:54) | **text-xl** tracking-tight | — | Card ×5 | "…" text only |

#### Findings

**F-2.1 (S2) The four AI and observability pages ignore every layout primitive.**
- Files: LlmDashboard, LlmLogs, AgentFleetPage, SmartLlmRouterPage.
- 20px title instead of 24px; no `max-w-7xl mx-auto`, so the title sits at x=24 instead of 56.
- Hand-built headers and tabs, and ad-hoc refresh buttons.

**F-2.2 (S2) The header bar title is wrong or missing for 7+ routes.**
- `components/layout/Header.tsx:58-125` holds a static `pageMetadata` map keyed by exact pathname. The fallback (`:460-463`) is `{ title: "Infrastructure Management", breadcrumbs: [{label: "Home"}] }`.
- Missing keys: `/fleet`, `/infrastructure`, `/catalog` (and its sub-paths), `/stacks`, `/auth-templates`, `/users`, and **every** `/projects/:id[/:section]`.
- Header titles also disagree with page h1s:

  | Route | Header bar | Page h1 |
  |---|---|---|
  | `/benchmarks` | Benchmarks | Performance Benchmarks |
  | `/ai/governance` | Token & Cost Governance | Token Intelligence |
  | `/ai/logs` | Request Audit Logs | LLM Logs |
  | `/system` | System | System Administration |
  | `/tasks` | Operations Log | Operations Log (match) |

- `/modules` metadata ("Module Catalog") is dead because `/modules` redirects to `/catalog`. `/settings` has metadata but no route.

**F-2.3 (S2) ProjectDetailV2 has its own page shell.**
- `min-h-screen` inside a height-bounded `<main>` (`:470`) creates a second scroll area. In the crawl, `scrollHeight` was 1814 against `clientHeight` 915.
- Sections use `max-w-7xl` **without `mx-auto`** (`:701`, `:710`, `:749`, …), so the content is left-aligned.
- The skeleton (`:452`) has no padding.
- Empty and not-found states are ad-hoc.

**F-2.4 (S2) Five tab idioms.**
1. `ResourceViewTabs` underline (strip or inline): canonical.
2. shadcn pill `TabsList`: `LlmDashboard.tsx:242`, `ProjectDetailV2.tsx:967`.
3. shadcn Tabs restyled as underline at text-xs: `AgentFleetPage.tsx:481-507`.
4. Custom `tabBtn` pills: `F5BNK.tsx:148`.
5. Benchmarks' "Mixed / AgentX / AIPerf" segmented control.

**F-2.5 (S2) Some tabs aren't linkable.** `CNF.tsx:60` and `CRExplorer.tsx:54` hold the view in `useState`, and `AgentFleetPage` is uncontrolled. Fleet accepts both `?tab` and `?view`.

**F-2.6 (S2) Loading, empty and error states differ.**
- CNF has none.
- Catalog uses a spinner where its siblings use Skeleton.
- The AI pages show "…".
- LlmLogs and LlmDashboard show ad-hoc text.
- Fleet and CRExplorer have no ErrorState.
- `SkeletonTable` is used only by Kubernetes and F5BNK.

**F-2.7 (S3) Refresh affordances differ.**
- `AgentFleetPage.tsx:374` "Sync Fleet" `<Button>` has **no `onClick` (S1 bug)**.
- `SmartLlmRouterPage.tsx:69-76` has a labelled "Refresh Telemetry" button at `h-8 text-xs`.
- `LlmLogs.tsx:218` puts a labelled "Refresh" button in its controls row.
- `LlmDashboard.tsx:155` hand-copies PageHeader's icon button.
- The standard is `PageHeader onRefresh` driven by `usePageRefresh`.

**F-2.8 (S3) Three table implementations.**
- Raw `<table className="w-full text-sm">` with `text-xs uppercase tracking-wider` headers: Projects:295, TaskHistory:525, Stacks:264.
- shadcn `Table`, whose headers are `font-medium` and normal case: everywhere else. 39 of its 259 `TableHead` uses override to uppercase.

**F-2.9 (S3) Card vs SectionCard.**
- AI pages: `<Card className="border-border"><CardContent className="p-4">` KPI tiles.
- Explorer landings: `Card` + `CardHeader` (`KubernetesV2.tsx:1090`, `F5BNK.tsx:1359`, `CNF.tsx:334`).
- ProjectDetailV2: raw bordered divs.
- Everything else: SectionCard.

**F-2.10 (S3) F5BNK sub-view widths drift.**
- Sub-views use `max-w-5xl` (`:158`, `:343`) or `max-w-6xl` (`:330`), against `max-w-7xl` on content pages.
- Section titles are `h2 text-xl font-semibold`, where explorer tables use `text-sm font-semibold`.

**F-2.11 (S3) Two KPI tile primitives.** `components/dashboard/StatCard.tsx` is unused by routed pages. `components/observability/StatTile.tsx` is used only by LlmLogs. The AI pages hand-build their own tiles.

**F-2.12 (S3) Stale docstrings.**
- `ResourceExplorerLayout.tsx:4` lists Stacks, Projects, TaskHistory and Modules as users, which is wrong.
- The PageHeader docstring omits CRExplorer.

### 4.3 Typography (R3)

Font sources:
- `index.html:13` loads Google Fonts Inter (300–700) and JetBrains Mono (**400 and 500 only**).
- `tailwind.config.js`: `sans: ['Inter','system-ui',…]`, `mono: ['JetBrains Mono','Fira Code','monospace']`.
- `styles.css` has no `@font-face`.
- Branding (`window.__BRAND__`, `lib/brand.ts`) swaps only the logo.

**F-3.1 (S2) `font-mono` is used as general UI text: 843 uses.**

| File | `font-mono` uses |
|---|---|
| `EPPRealtimeDashboard.tsx` | 48 |
| `InferenceXRunDetail.tsx` | 37 |
| `DpuPanel.tsx` | 35 |
| `BenchmarkRunDetail.tsx` | 25 |
| `BenchmarkCompareTab.tsx` | 24 |
| `ClusterScanResults.tsx` | 23 |
| `DpuConnectivityTables.tsx` | 22 |
| `BenchmarkOverviewTab.tsx` | 21 |
| `CNFNetworkGraph.tsx` | 20 |
| `BenchmarkAgentsTab.tsx` | 19 |
| `LlmDashboard.tsx` | 18 |
| `AgentFleetPage.tsx` | 15 |

- It is used for KPI numbers, headings, badges and select triggers.
- Mono **headings**: `ai/SmartLlmRouterPage.tsx:89,108,127,146` and `ai/AgentFleetPage.tsx:397,418,437,460`.
- KPI values: 9× `text-2xl font-bold font-mono` and 8× `text-xl font-bold font-mono` on AI and benchmark pages, against 22× plain `text-2xl font-bold` on ops pages.
- Live: Agent Fleet is 43 mono vs 38 Inter elements; Benchmarks is 57 vs 72.

**F-3.2 (S2) Faux bold.** 85 places combine `font-mono` with `font-bold` or `font-semibold`. Mono 600/700 isn't loaded, so the browser synthesises bold, which renders smeared.

**F-3.3 (S2) No small-text scale.**

| Class | Count |
|---|---|
| `text-xs` | 2752 |
| `text-sm` | 1263 |
| `text-base` | 48 |
| `text-lg` | 107 |
| `text-xl` | 64 |
| `text-2xl` | 81 |
| `text-3xl` | 1 |

- **708 arbitrary sizes:** `text-[10px]` 478, `text-[11px]` 214, `text-[9px]` 16.
- Top files: `k8s/ClusterScanResults.tsx` 30, `k8s/PolicyBuilder.tsx` 29, `pages/Fleet.tsx` 28, `k8s/TrafficFlowOverview.tsx` 28, `BenchmarkOverviewTab.tsx` 27, `observability/LlmDashboard.tsx` 26, `stacks/StackDetailDialog.tsx` 26.
- Recharts `fontSize` takes 5 values: 10 ×18, 11 ×34, 12 ×11, 13 ×4, 16 ×1.
- Micro-labels: 178 `uppercase` combined with xs/10/11px, with tracking split across `tracking-wider` 139, `tracking-wide` 35 and `tracking-widest` 3.

**F-3.4 (S3) Heading styles are effectively dead.**
- The `styles.css:107-126` h1–h4 scale (h1 3xl, h2 2xl, h3 xl) is overridden almost everywhere.
- h2: 33 uses with 12 distinct class combos (`text-sm` → `text-xl`).
- h3: 150 uses, sized `text-sm` ×59, `text-lg` ×40, `text-base` ×16, `text-2xl` ×4.
- `CardTitle`'s default is `text-2xl font-semibold`, but 54 of its 57 uses override it. Card headers therefore range from 14px to 18px.

**F-3.5 (S3) Components with their own font stacks.**
- `observability/Gauge.tsx:66` uses `ui-monospace`.
- `k8s/PodExecTerminal.tsx:190` uses Menlo/Monaco.
- `dpu/DpuTerminalDialog.tsx:90` uses a different stack.
- Monaco (`YamlEditor.tsx:131`, `F5iRuleViewer.tsx:150`) uses its own default at size 13.
- `YamlEditor.tsx:142` is always `vs-dark`, even in light theme.

**F-3.6 (S3) Offline risk.** Fonts come from Google Fonts at runtime. Air-gapped installs fall back to `system-ui`, so every page uses a different font from the design.

### 4.4 Components, colour and tokens (R4)

**F-4.1 (S2) Status colour semantics conflict.**
- There are 48 separate status-badge or colour-mapping functions.
- `StatusBadge` is defined 7 times: `benchmark-utils.tsx:122`, `DpuTerminalDialog.tsx:338`, `LlmLogs.tsx:599`, `TrafficFlowOverview.tsx:162`, `F5BNKTopologyViewer.tsx:338`, `DPFInfrastructurePanel.tsx:70`, `migration/ScanCard.tsx:31`.
- `getStatusColor` exists 5+ times. `Fleet.tsx` has 3 local badges and `BareMetalPanel` has 2.
- The central `lib/status-colors.ts` (exports `MODULE_STATUS_COLORS`, `TASK_STATUS_COLORS`, `getResourceStatusColor`, `getModuleStatusColor`, `getTaskStatusColor`) is imported by **only 4 files**.
- **Conflicts:**
  - `pending`: warning in `status-colors.ts:41` and `ModuleStatusBadge.tsx:26`; muted in `benchmark-utils.tsx:70`; secondary with hex `#71717a` in `benchmark-utils.tsx:100`. Codebase-wide: muted ×9, warning ×4, info ×3.
  - `running`: primary ×4, info ×4, muted ×2, plus single warning and success uses.
  - `queued`: warning (`TaskHistory.tsx:93`).
- `ClusterStatusBadge` uses `text-[11px]`; `ConnectionStatusBadge` uses a dot plus a tinted background.
- 54 `<Badge>` colour overrides via className; 43 hand-built coloured pill `<span>`s (`CNFNetworkGraph` 7, `Fleet` 5, `F5AIAnalyzerViewer` 4).

**F-4.2 (S3) Primitive bypass outside `components/ui/`.**

| Raw element | Count | Files | Top files |
|---|---|---|---|
| `<button>` | 245 | 91 | PolicyBuilder 16, Fleet 15, ConfigBuilder 9, MultiCloudEstate 9, BareMetalPanel 9, BenchmarkAgentsTab 8 |
| `<input>` | 59 | 27 | — |
| `<select>` | 37 | 9 | Fleet 17, BareMetalPanel 10 |
| `<table>` | 36 | 29 | — |

- `Fleet.tsx` (~3395–3604) has hand-rolled inputs and selects styled `rounded-md bg-card px-2 py-1 text-sm`, sitting next to shadcn `h-10 bg-background px-3 py-2` controls on the same page.
- Hand-built modal overlays (`fixed inset-0`): `SnapshotHistory`, `PolicyBuilder`, `BareMetalPanel`, `RestoreOverlay`.

**F-4.3 (S3) Chart theme is copy-pasted.**
- `CHART_GRID`, `CHART_TEXT` and `CHART_TOOLTIP` are re-declared in 5 files: `BenchmarkCurvesView.tsx:49`, `BenchmarkRunDetail.tsx:90`, `InferenceXRunDetail.tsx:60`, `BenchmarkTrendsView.tsx:39`, `EPPRealtimeDashboard.tsx:54`.
- They should import `components/observability/chart-theme.ts`, which exports `CHART_GRID`, `CHART_TEXT`, `CHART_TOOLTIP`, `SERIES_COLORS`, `seriesColor`, `SUCCESS_COLOR`, `ERROR_COLOR`, `PROVIDER_COLORS` and `providerColor`.
- Inline hex bar colours, e.g. `BenchmarkCompareTab.tsx:542-560`.

**F-4.4 (S3) Corner radius is mixed.**
- `card.tsx:12` uses `rounded-xl`.
- 146 hand-built `bg-card` div cards use `rounded-lg` (298 uses) or `rounded-md` (141).
- Codebase totals: `rounded` 320, `rounded-md` 311, `rounded-lg` 537, `rounded-xl` 35.

**F-4.5 (S3) Terminal themes differ.** PodExec uses `#0f172a` (slate); the DPU terminal uses `#0a0a0a`.

**F-4.6 (S3) Raw palette colours are minor.**
- Only 29 occurrences; 11 of them are in `deployments/DeploymentPipeline.tsx` (`text-zinc-400`, `bg-zinc-500/10`, from line 92).
- 186 hex literals, all in charts, graphs and terminals.

### 4.5 Bugs found incidentally (fix in the Quick Wins PR)

| ID | Bug | Location |
|---|---|---|
| B-1 | Shared cluster scope wiped by CNF and BNK (F-1.1) | `CNF.tsx:95-102`, `F5BNK.tsx:805-813` |
| B-2 | "Sync Fleet" button has no `onClick` | `pages/ai/AgentFleetPage.tsx:374` |
| B-3 | Header bar shows "Home / Infrastructure Management" on 7+ routes | `components/layout/Header.tsx:58-125, 460-463` |
| B-4 | Writes to dead localStorage keys | `pages/Fleet.tsx:1051,1059` |
| B-5 | ProjectDetailV2 double scroll (`min-h-screen` in a bounded `<main>`) | `ProjectDetailV2.tsx:470` |
| B-6 | Cluster picker probably filters nothing on Agent Fleet (sample data); verify | `AgentFleetPage.tsx:59+` |

---

## 5. Decisions (put in an ADR before Phase 1)

Create `docs/adr/D-036-frontend-design-consistency.md`. Check `docs/adr/README.md` for the next free number; D-034 is duplicated, so verify. The recommended defaults below are what the plan assumes. **If the human owner hasn't confirmed them, raise them on the GitHub issue before starting Phase 1.**

| # | Decision | Recommended default |
|---|---|---|
| D1 | How "all" is represented in scope | `null` in state; **omit** the URL param (no `cluster=all` sentinel). Persist `null` as an explicit `"all"` string in localStorage so "all" round-trips instead of falling back to each page's own default. |
| D2 | Is project scope global like cluster scope? | **Yes.** One `project` scope shared app-wide. A cluster that isn't in the selected project **clears the project** (widen), never the cluster. |
| D3 | Namespace default | `"default"`, persisted per cluster. "All Namespaces" is offered but never auto-selected. |
| D4 | Where the scope picker lives | Stay **per page** (no header-level global picker yet), but always the same `ScopePicker` component in a consistent slot: the explorer sticky bar for REL pages, `PageHeader actions` for content pages. |
| D5 | Page width | Explorer pages (REL) are full-bleed. Every other page uses `max-w-7xl mx-auto p-6 space-y-6`. |
| D6 | Mono usage rule | Mono **only** for code, YAML, IDs, IPs, versions, hashes, CLI and log lines. Numbers use Inter with `tabular-nums`. Never use mono for headings, labels, badges or select triggers. |
| D7 | Font hosting | Self-host Inter and JetBrains Mono via `@fontsource/*` (works offline). Load mono at 400, 500, 600 and 700. |
| D8 | Canonical status palette | `lib/status-colors.ts`. `pending`/`queued` = muted, `running`/`in_progress` = info, `success`/`ready`/`reachable` = success, `warning`/`degraded`/`throttled` = warning, `failed`/`error` = destructive. |

---

## 6. Remediation plan

Phases are ordered by user impact. Each phase is one PR with one GitHub issue.

### Phase 0: Quick wins (small PR, low risk)

**Tasks**
1. **B-1:** in `CNF.tsx` and `F5BNK.tsx`, when the selected cluster isn't in the selected project, clear the **project** (or just stop filtering) instead of clearing the shared cluster. Remove `localStorage.removeItem(STORAGE_KEYS.CNF_CLUSTER)`. This is a stop-gap; Phase 1 replaces it properly.
2. **B-2:** wire "Sync Fleet" to a refetch of the page's queries, or remove the button if there's nothing to sync. Check whether `AgentFleetPage` has any query to refetch; it may be pure sample data.
3. **B-3:** add `pageMetadata` entries in `Header.tsx` for `/fleet`, `/infrastructure`, `/catalog`, `/stacks` (title "Blueprints"), `/auth-templates` ("Access Methods"), `/users`. Add a prefix match so `/projects/:id…` gets title "Projects" with a breadcrumb. Change the fallback to derive from the sidebar nav label rather than "Infrastructure Management". Remove the dead `/modules` and `/settings` entries.
4. Align titles so the header bar and the page h1 match. Decide one name per page; the sidebar label is probably the source of truth:
   - Benchmarks
   - Token & Cost Governance
   - Request Audit Logs
   - System
5. **B-4:** delete the dead writes at `Fleet.tsx:1051,1059`; delete `HELM_CLUSTER` if it has no readers.
6. **F-3.2:** add JetBrains Mono `wght@400;500;600;700` to `index.html:13`. This is a one-line, immediate visual fix; D7 supersedes it later.

**Acceptance**
- A new test proves that going `/kubernetes` (cluster X) → `/cnf` (different stored project) → `/kubernetes` keeps cluster X.
- Crawl (Appendix A): no route shows "Infrastructure Management" in the header bar.
- `npm run lint`, `npm run test` and `tsc` pass.

### Phase 1: Unified scope state + one ScopePicker (R1)

**Tasks**
1. **Store.** Create `stores/scopeStore.ts` (zustand, matching the existing `stores/` conventions) holding `{ clusterId: number|null, projectId: number|null, namespaceByCluster: Record<number,string> }`. Persist it under one key, e.g. `bnk-forge-scope`. Write a one-time migration that reads the old `bnk-forge-cluster-scope`, `bnk-forge-k8s-project`, `bnk-forge-bnk-project`, `bnk-forge-cnf-project` and `bnk-forge-k8s-namespace` keys, then deletes them.
2. **Hook.** Create `useScope()` to sync the store with the URL (`?cluster`, `?project`, `?ns`): the URL wins on mount, and store changes write to the URL with `replace`. **Fix in place:** turn `hooks/useClusterScope.ts` into this hook (or a thin wrapper over it) rather than adding a parallel one, and delete `readClusterScope`/`writeClusterScope` once their callers have moved.
3. **Storage keys.** In `lib/storage-keys.ts`, remove the `K8S_CLUSTER`, `BNK_CLUSTER`, `CNF_CLUSTER`, `*_PROJECT`, `K8S_NAMESPACE` and `HELM_CLUSTER` entries once nothing references them.
4. **Component.** Create `components/shared/ScopePicker.tsx`, or better, **extend `ResourcePageHeader`'s existing project/cluster/namespace selects in place** and extract them into a reusable component it consumes.
   - Spec: shadcn Select, `h-9`, widths 180/200/180, status dot on clusters, labels "All Projects" / "All Clusters" / "All Namespaces", Skeleton while loading, "No clusters" empty item, `aria-label`.
   - Props: `show={{project, cluster, namespace}}`, `allowAllClusters` (default **true**).
5. **Replace or retire.**
   - `components/observability/pickers.tsx` `ClusterPicker`: re-implement it on top of ScopePicker or delete it, keeping `FilterSelect`.
   - `DpuInfrastructurePanel` native `<select>`.
   - `TaskHistory` native project `<select>`.
   - `BenchmarkTargetsTab`, `BenchmarkTrendsView` and `RunBenchmarkWizard` form selects can stay as form fields (they're form inputs, not scope), but should share the same label and status rendering.
   - Fleet compare and `ConfigPromotionWizard` native selects become shadcn Select.
6. **Migrate pages** to `useScope()`: KubernetesV2, F5BNK, CNF, CRExplorer, Benchmarks, LlmDashboard and LlmLogs (`use-observability-filters.ts`; drop the `all` sentinel), AgentFleetPage, SmartLlmRouterPage, Infrastructure.
7. **CRExplorer:** use `useAllClusters` with client-side project filtering, like its siblings, and `allowAllClusters`. Remove the auto-pick of the first cluster.
8. **Namespace default:** apply D3 everywhere (F5BNK `:708`, `CNF.tsx:126`, `CRExplorer.tsx:103`).
9. **Hooks:**
   - Merge `hooks/useK8sClusters.ts` and `hooks/k8s/useClusterCRUD.ts` into one module. Keep `useK8sClusters.ts` as the canonical path, since it has the most importers. Turn the other into re-exports or delete it, and update the imports.
   - Replace the inline `['projects']` queries in `StackDetailDialog.tsx:409` and `ImportedBlueprintDeployDialog.tsx:65`, and the direct call in `useDeployments.ts:45`, with `useProjects()`.

**Acceptance**
- Unit tests for `useScope`:
  - URL → store
  - store → URL
  - "all" round-trip
  - migration from the old keys
  - clearing the project when the cluster is out of project
- Integration test: deep link `/cnf?cluster=<id>&project=<id>` selects both. The same works for `/crds` and `/ai/agents`.
- Crawl: every cluster picker on every route reports the same height (36) and width (200), and "All Clusters" is the default everywhere.
- `grep -rn "<select" src --include=*.tsx | grep -v components/ui` returns no scope selects.

### Phase 2: One page shell and header (R2)

**Tasks**
1. Create `components/layout/PageShell.tsx`: `<div className="p-6 space-y-6 max-w-7xl mx-auto">` with an optional `width="full"` for exceptions. Adopt it on every non-REL page, replacing the copy-pasted wrapper strings. Fix in place; don't fork PageHeader.
2. **AI and observability pages** (`LlmDashboard`, `LlmLogs`, `AgentFleetPage`, `SmartLlmRouterPage`): replace the hand-rolled header with `PageHeader`. Put the picker in `actions`, wire `onRefresh` from `usePageRefresh`, use `titleBadge` for "Demo agent registry", and wrap in `PageShell`.
3. **ProjectDetailV2:**
   - remove `min-h-screen`
   - add `mx-auto` to section containers, or wrap in `PageShell width="full"` consistently
   - use `PageHeader` with a back-link slot (add an optional `backHref` prop to PageHeader in place if needed)
   - pad the skeleton
   - use `EmptyState` for empty and not-found
4. **Header title source of truth:** move page titles to route `handle` metadata in `router.tsx` (`handle: { title, breadcrumbs }`). Have `Header.tsx` read them via `useMatches()` and delete the static `pageMetadata` map. Optionally have `PageHeader` default its `title` from the same handle so the two can't diverge.
5. **Tabs:** replace pill `TabsList` (`LlmDashboard.tsx:242`, `ProjectDetailV2.tsx:967`), the restyled Tabs (`AgentFleetPage.tsx:481-507`) and `tabBtn` (`F5BNK.tsx:148`) with `ResourceViewTabs`.
   - Make CNF (`:60`) and CRExplorer (`:54`) URL-synced via `?view`.
   - Normalise Fleet to a single param, `?tab`; keep `?view` as a read-only alias for old links.
6. **States:**
   - every data page uses Skeleton (or SkeletonTable for tables), then `ErrorState`, then `EmptyState`
   - add the missing ones: CNF, Fleet ErrorState, CRExplorer ErrorState, the AI pages, LlmLogs (`:305`), LlmDashboard (`:943`)
   - Catalog: replace the spinner fallback with Skeleton
7. **Cards and tables:**
   - AI KPI tiles and explorer landing `Card`s → `SectionCard`
   - raw `<table>` in Projects, TaskHistory and Stacks → shadcn `Table`
   - decide one header-cell style (recommend shadcn default `TableHead`, no uppercase) and remove the 39 uppercase overrides
8. **KPI tiles:** keep one primitive. `StatTile` is the more recent; check which is closer to the design. Migrate the AI pages and TaskHistory tiles to it, and delete the other.
9. **F5BNK sub-views:** standardise on `max-w-7xl`, with section titles via `SectionCard` title rather than `h2 text-xl`.
10. Fix the stale docstrings in `ResourceExplorerLayout.tsx:4` and `PageHeader.tsx`.

**Acceptance**
- Crawl:
  - every non-REL route has its h1 at **x=56 y=24, 24px/700**
  - every REL route has its h1 at **x=24 y=16, 24px/700**
  - the header bar title equals the page h1 text, or a documented alias
  - no route has a `scrollHeight` overflow caused by `min-h-screen`
- `grep -rn "<h1" src/pages` returns only `PageHeader`/`ResourcePageHeader`, plus Login and Dashboard's greeting if kept intentionally.
- `grep -rn "TabsList" src/pages src/components | grep -v components/ui` returns nothing, or only documented exceptions inside dialogs.

### Phase 3: Typography rules (R3)

**Tasks**
1. **D7:** add `@fontsource-variable/inter` and `@fontsource/jetbrains-mono` (400, 500, 600, 700), import them in `main.tsx`, and remove the Google Fonts `<link>` and preconnects from `index.html`.
2. **Tailwind tokens** in `tailwind.config.js`:
   - add `fontSize: { '2xs': ['0.6875rem', { lineHeight: '1rem' }] }` (11px) and use it everywhere for micro-labels
   - map `text-[10px]` and `text-[11px]` → `text-2xs`, and `text-[9px]` → `text-2xs`, after a design check
   - add a `.label-caps` utility in `styles.css` (`@layer components`: `text-2xs uppercase tracking-wider font-medium text-muted-foreground`) to replace the 178 ad-hoc micro-label combos
3. **Apply D6, file by file** (top offenders first; see F-3.1):
   - remove `font-mono` from headings, KPI values, badges and select triggers
   - use `tabular-nums` for numeric KPIs
   - keep mono for IDs, IPs, versions, YAML and logs
   - fix mono headings at `SmartLlmRouterPage.tsx:89,108,127,146` and `AgentFleetPage.tsx:397,418,437,460`
4. **CardTitle:** change the default in `components/ui/card.tsx` to `text-base font-semibold leading-none tracking-tight`, then remove the now-redundant size overrides at the 54 call sites. Keep the deliberately different ones.
5. **Headings:** align the `styles.css:107-126` heading scale with actual usage (page title 2xl/bold, section title base/semibold, sub-section sm/semibold), or remove it.
6. **Charts:** every Recharts consumer imports `CHART_GRID`, `CHART_TEXT` and `CHART_TOOLTIP` from `components/observability/chart-theme.ts`. Add `CHART_FONT_SIZE = 11` there, delete the 5 local copies, and replace the inline hex bar colours with `seriesColor()` or the semantic colours.
7. **Editors and terminals:**
   - one terminal theme constant shared by `PodExecTerminal` and `DpuTerminalDialog`, both with `fontFamily: 'JetBrains Mono, monospace'`
   - `Gauge.tsx:66` uses the `font-mono` class
   - `YamlEditor`: theme follows `uiStore.theme` (`vs` / `vs-dark`) and `fontFamily: 'JetBrains Mono'`

**Acceptance**
- Crawl:
  - no route has a Mono:Inter ratio above ~0.35, except the log, YAML and terminal views
  - Agent Fleet and Benchmarks drop below that ratio
- `grep -rnE "text-\[(9|10|11)px\]" src | grep -v __tests__ | wc -l` → 0.
- `grep -rnE "font-mono[^\"]*font-(bold|semibold)|font-(bold|semibold)[^\"]*font-mono" src` → only intentional uses, and all are now real weights.
- The app renders correctly with the network blocked to `fonts.googleapis.com`.

### Phase 4: Primitive and colour consolidation (R4)

**Tasks**
1. **Status:** extend `lib/status-colors.ts` with a single `getStatusTone(status) → 'success'|'warning'|'info'|'muted'|'destructive'` following D8. Create (or promote) one `components/ui/StatusBadge.tsx` that uses it. Replace the 7 `StatusBadge` copies, 5+ `getStatusColor` copies, local Fleet and BareMetal badges, and the 43 hand-coloured `<span>` pills. Align `ClusterStatusBadge` and `ConnectionStatusBadge` visually: dot plus tinted background, `text-2xs`.
2. **Raw elements:**
   - `<select>` → shadcn `Select` (Fleet ×17, BareMetalPanel ×10, …)
   - `<button>` → `Button` (variant `ghost`/`link` where needed)
   - `<input>` → `Input`
   - custom `fixed inset-0` overlays → `Dialog`/`Sheet` (SnapshotHistory, PolicyBuilder, BareMetalPanel, RestoreOverlay; check RestoreOverlay first, a full-page blocker may be intentional)
3. **Cards:** hand-built `bg-card rounded-* border` divs → `SectionCard`/`Card`. Pick one radius (recommend `rounded-lg` for both, and change `card.tsx:12` from `rounded-xl` to `rounded-lg`).
4. **`DeploymentPipeline.tsx`:** zinc palette → tokens.

**Acceptance**
- `grep -rn "function StatusBadge\|function getStatusColor" src | grep -v components/ui | grep -v lib/status-colors` → 0.
- `grep -rn "<select\b" src --include=*.tsx | grep -v components/ui` → 0.
- Visual: a "pending" status renders the same colour on Operations Log, Benchmarks, Projects and Fleet.

### Phase 5: Prevent regression

**Tasks**
1. ESLint rules in `frontend-v2/eslint.config.js`, using `no-restricted-syntax` and `react/forbid-elements`, or a small custom rule:
   - forbid JSX `<select>`, `<table>`, `<input>` and `<button>` outside `src/components/ui/**` (start as `warn`, flip to `error` once Phase 4 lands)
   - forbid arbitrary `text-[Npx]` classes (regex on `className` string literals)
   - forbid `font-mono` together with `text-2xl`/`text-xl` and `font-bold`
   - forbid importing `TabsList` outside `components/ui` and dialogs
2. Add the Appendix A crawl as a Playwright test under `frontend-v2/` or `tests/e2e/` (check the existing e2e conventions in `docs/TESTING.md`) that asserts the layout invariants from the Phase 2 and 3 acceptance criteria. Optionally add screenshot baselines.
3. Document the rules (D1–D8, primitive list, mono rule, `text-2xs`, `label-caps`) in `docs/DEVELOPMENT.md` under the frontend style section.

**Acceptance**
- Lint passes at `error` level on main.
- The e2e layout test runs in CI.

---

## 7. Suggested GitHub issues / PR breakdown

| PR | Issue title | Depends on | Size |
|---|---|---|---|
| 1 | fix(ui): stop CNF/BNK wiping shared cluster scope; header titles; Sync Fleet; mono weights | — | S |
| 2 | ADR D-036 frontend design consistency | — | S (doc) |
| 3 | feat(ui): unified scope store + ScopePicker; migrate scope pages | 2 | L |
| 4 | refactor(ui): PageShell + PageHeader on AI/obs/project detail; route-handle titles; tabs; states | 2 | L |
| 5 | refactor(ui): typography tokens, mono rule, self-hosted fonts, chart theme | 2 | M–L |
| 6 | refactor(ui): StatusBadge/status tone, raw primitive replacement, card radius | 2 | L |
| 7 | chore(ui): lint guards + e2e layout invariants + DEVELOPMENT.md | 3–6 | M |

PRs 3–6 touch overlapping files (`Fleet.tsx`, `F5BNK.tsx`, `CNF.tsx`, the AI pages). Merge them in order rather than in parallel to avoid painful conflicts.

---

## 8. Out of scope / not verified

- Dark-mode-specific issues: the audit was in light mode. The colour-token audit found very few raw palette colours, so dark mode is likely OK apart from charts and the YAML editor (F-3.5).
- Mobile and narrow viewports: only 1600×1000 was measured.
- Dialogs and sheets were not crawled individually; findings there come from static analysis only.
- Accessibility beyond aria-labels on pickers was not audited.
- B-6 (Agent Fleet picker filters nothing) is inferred from code and still needs confirming.

---

## Appendix A — Live crawl script (verification tool)

Use this to re-run the measurements after each phase. It needs Playwright and a Chromium binary. At audit time, an npx-cached Playwright plus the cached `chromium-1228` were used. Adjust both paths, or simply `npm i -D playwright && npx playwright install chromium` in a scratch directory **outside the repo**.

```js
// crawl.mjs — usage: node crawl.mjs / /projects /kubernetes ...
import { chromium } from 'playwright';
const BASE = process.env.BASE ?? 'https://localhost';
const browser = await chromium.launch(/* { executablePath } if needed */);
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();
await page.goto(BASE + '/login'); await page.waitForTimeout(1500);
await page.fill('input[type="text"]', process.env.FORGE_USER ?? 'admin');
await page.fill('input[type="password"]', process.env.FORGE_PASS);
await page.keyboard.press('Enter'); await page.waitForTimeout(3000);
for (const r of process.argv.slice(2)) {
  await page.goto(BASE + r, { waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2500);
  const x = await page.evaluate(() => {
    const fam = new Map(), sizes = new Map();
    const main = document.querySelector('main') || document.body;
    for (const el of main.querySelectorAll('*')) {
      if (![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 1)) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const f = cs.fontFamily.split(',')[0].replace(/["']/g, '').trim();
      fam.set(f, (fam.get(f) || 0) + 1);
      sizes.set(cs.fontSize, (sizes.get(cs.fontSize) || 0) + 1);
    }
    const mr = main.getBoundingClientRect();
    const h = main.querySelector('h1,h2'); const hr = h?.getBoundingClientRect();
    let w = main; while (w.children.length === 1) w = w.children[0];
    const headerTitle = document.querySelector('header')?.innerText.split('\n').slice(0, 2).join(' / ');
    const pickers = [...main.querySelectorAll('button[role="combobox"], select')].map(b => {
      const rr = b.getBoundingClientRect();
      return `${b.tagName.toLowerCase()} "${(b.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 30)}" ${Math.round(rr.width)}x${Math.round(rr.height)}`;
    });
    return {
      headerTitle,
      h1: h ? `${h.textContent.trim().slice(0, 40)} ${getComputedStyle(h).fontSize}/${getComputedStyle(h).fontWeight} @x=${Math.round(hr.x - mr.x)},y=${Math.round(hr.y - mr.y)}` : 'none',
      fonts: [...fam], sizes: [...sizes].sort((a, b) => b[1] - a[1]).slice(0, 6),
      wrapper: String(w.className).slice(0, 80), scroll: `${main.scrollHeight}/${main.clientHeight}`, pickers,
    };
  });
  console.log(r, JSON.stringify(x));
  await page.screenshot({ path: `shot_${r.replace(/[\/:?=&]/g, '_') || 'root'}.png` });
}
await browser.close();
```

Routes to crawl: `/ /projects /projects/<id> /catalog /tasks /kubernetes /crds /bnk /cnf /stacks /auth-templates /system /fleet /infrastructure /benchmarks /ai/agents /ai/governance /ai/routing /ai/logs /users`.

Scope-persistence check (Phase 0 and 1): select a cluster on `/kubernetes`, navigate `/cnf` → `/bnk` → `/benchmarks` → `/ai/agents` → `/kubernetes`, and assert that the cluster picker text is unchanged on every page.
