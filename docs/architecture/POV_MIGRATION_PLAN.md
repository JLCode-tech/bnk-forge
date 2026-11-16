# BNK Forge 4.3.3 → PoV Architecture Migration Plan
**Document Version:** 1.0.0-pov  
**Status:** Approved for Implementation  
**Starting Baseline:** BNK Forge v4.3.3 (Localhost Docker-Compose Pull Engine)  
**Target Architecture:** Push-Based Fleet Platform (North Star Architecture)  
**Related Specifications:**
* [**FORGE_AGENT_ARCHITECTURE.md**](./FORGE_AGENT_ARCHITECTURE.md) (Edge Go Agent, Socket eBPF, TMM Enrichment)
* [**DATA_PLATFORM.md**](./DATA_PLATFORM.md) (ClickHouse, NATS JetStream, K8s Jobs)
* [**SCHEMA_MANAGEMENT.md**](./SCHEMA_MANAGEMENT.md) (Atlas Declarative Schema & Alembic Retirement)

---

## 1. Migration Philosophy & Localhost Continuity

The transition of BNK Forge 4.3.3 to the new push-based architecture is governed by the **Strangler Migration Pattern**:
1. **Zero Disruption to Local Development:** Developers must be able to continue running `docker-compose up` on localhost throughout the migration.
2. **Coexistence of Push and Pull:** The existing Direct `kubeconfig` pull engine (`kr8s`, 64-thread parallel fetch) remains fully operational as a fallback while the new push-based agent and ingest pipeline are brought online.
3. **Incremental Component Swaps:** Services are replaced one at a time:
   * First: Database schema governance (Atlas replaces Alembic).
   * Second: Telemetry hot path (ClickHouse & Ingest Gateway added).
   * Third: Edge agent (Go agent streams telemetry).
   * Fourth: Messaging & tasks (NATS JetStream replaces Redis and Celery).
   * Fifth: Packaging (Helm charts, air-gap bundle, Ed25519 licensing).

---

## 2. Component Migration Matrix: 4.3.3 vs. Target PoV

| Subsystem | Forge 4.3.3 (Localhost Today) | Migration Milestone | Target PoV Architecture |
| :--- | :--- | :--- | :--- |
| **Relational Schema** | PostgreSQL 16 + 163 Alembic migrations + stamped-head `init_db.py` | **Milestone 1** | PostgreSQL 16 managed declaratively via **Atlas (`schema.hcl`)** |
| **Telemetry Ingestion** | Central pull via Celery Beat every 60s; 64-thread API query | **Milestone 2 & 3** | **Outbound Push:** Go Agent $\rightarrow$ **`forge-ingest` Gateway (`:17543`)** |
| **Telemetry Storage** | Ephemeral Redis cache (60s TTL) + Postgres JSON blobs | **Milestone 2** | **ClickHouse Cluster** (Columnar time-series, eBPF flows, TMM metrics) |
| **Edge Agent** | None (central `kubectl exec` into TMM debug sidecar) | **Milestone 3** | **`forge-agent` (Go DaemonSet)**: Socket eBPF + TMM DPDK UDS Harvester |
| **Async Task Engine** | Redis 7 + Celery Workers (x2) + Celery Beat | **Milestone 5** | **NATS JetStream WorkQueues** (Light tasks) + **K8s Jobs** (Heavy batch) |
| **Edge Transport** | Inbound HTTPS `:6443` into customer cluster | **Milestone 3 & 6** | Pluggable **gRPC Bidi Stream (mTLS)** & **NATS JetStream Leaf Nodes** |
| **Air-Gap & License** | In-memory license check, requires live DB | **Milestone 6** | **Offline Ed25519 License JWT** + Modular `forgectl` air-gap tarball |

---

## 3. Phased Implementation Milestones

```mermaid
gantt
    title BNK Forge 4.3.3 -> PoV Migration Milestones
    dateFormat  X
    axisFormat  M%s
    section M0: Localhost Baseline
    Add ClickHouse & NATS to compose       :m0_1, 0, 2
    section M1: Atlas Cutover
    Extract schema.hcl & squash Alembic   :m1_1, after m0_1, 3
    Idempotent seed runner & CI guard     :m1_2, after m1_1, 2
    section M2: Ingest Hot Path
    Protobuf contracts & Go Ingest GW     :m2_1, after m1_2, 4
    ClickHouse bulk writer & NATS pub     :m2_2, after m2_1, 3
    section M3: Agent MVP
    Go Agent Informers & Socket eBPF      :m3_1, after m2_2, 5
    TMM UDS Harvester & gRPC Streamer     :m3_2, after m3_1, 4
    section M4: Strangler Facade
    ClusterDataProvider router in FastAPI :m4_1, after m3_2, 3
    Transparent UI Telemetry Switch       :m4_2, after m4_1, 2
    section M5: Celery Decommission
    NATS JetStream WorkQueues             :m5_1, after m4_2, 4
    K8s Job Controller for QKView/aiperf  :m5_2, after m5_1, 3
    Decommission Redis & Celery           :m5_3, after m5_2, 2
    section M6: PoV Packaging
    NATS Leaf Node Transport              :m6_1, after m5_3, 3
    Ed25519 License Engine & Helm Charts  :m6_2, after m6_1, 4
```

---

### Milestone 0: Localhost Infrastructure Preparation
**Goal:** Introduce the new storage and messaging engines into the local `docker-compose.yml` environment alongside the existing services without breaking running applications.

* **Tasks:**
  1. Add `clickhouse` service (`clickhouse/clickhouse-server:24.3-alpine`) to `docker-compose.yml` exposed on `:8123` (HTTP) and `:9000` (Native TCP).
  2. Add `nats` service (`nats:2.10-alpine` with `-js` JetStream flag enabled) to `docker-compose.yml` exposed on `:4222` (client) and `:8222` (monitoring).
  3. Initialize persistent docker volumes: `clickhouse_data`, `nats_data`.
  4. Verify existing FastAPI backend, frontend, and Celery workers boot normally with zero regressions.

---

### Milestone 1: Database Migration & Alembic Retirement
**Goal:** Retire the 163 fragile Alembic migrations and establish Atlas declarative schema governance. Reference: [SCHEMA_MANAGEMENT.md](./SCHEMA_MANAGEMENT.md).

* **Tasks:**
  1. **Baseline Extraction:** Inspect the canonical PostgreSQL 16 schema on localhost and generate `backend/schema/schema.hcl`:
     ```bash
     atlas schema inspect -u "postgres://forge:secret@localhost:5432/forge?sslmode=disable" > backend/schema/schema.hcl
     ```
  2. **Archive Alembic Migrations:** Move all 163 migration files to `backend/alembic/legacy_v2_archive/`.
  3. **Idempotent Seed Runner:** Create `backend/seeds/seed_runner.py` to handle initial roles, admin users, and default credential templates using `ON CONFLICT DO UPDATE` or `ON CONFLICT DO NOTHING`.
  4. **Startup Refactor:** Update `backend/init_db.py` and `backend/entrypoint.sh` to execute `atlas schema apply --auto-approve` followed by the seed runner, eliminating the `create_all() + stamp head` anti-pattern.
  5. **CI Guardrail:** Add GitHub Action for automated schema linting: `atlas schema test --env ci`.

---

### Milestone 2: High-Throughput Ingest Gateway (`forge-ingest`)
**Goal:** Build the Go Ingest Gateway (`:17543`) handling mTLS stream termination and bulk writing to ClickHouse and NATS. Reference: [DATA_PLATFORM.md](./DATA_PLATFORM.md).

* **Tasks:**
  1. **Protobuf Definitions:** Author `pkg/proto/forge/v1/telemetry.proto` defining:
     * `StreamTelemetry(stream TelemetryBatch) returns (stream ControlCommand)`
     * `RegisterAgent(RegisterRequest) returns (RegisterResponse)`
     * `Heartbeat(Ping) returns (Pong)`
  2. **Go Ingest Binary:** Author `cmd/forge-ingest/main.go` and `pkg/ingest/`:
     * Terminate mTLS on `:17543` using a local test CA.
     * Implement memory-ring buffer batching (5,000 records or 1,000ms flush).
     * Connect to ClickHouse via native TCP driver (`clickhouse-go/v2`) and execute bulk inserts into `forge.ebpf_socket_flows` and `forge.tmm_dpdk_metrics`.
     * Publish state events to NATS subject `forge.cluster.{id}.events`.
  3. **Compose Integration:** Add `forge-ingest` container to `docker-compose.yml`.

---

### Milestone 3: Core Forge Agent MVP on Local Cluster
**Goal:** Implement the Go edge agent and run it against a local Kubernetes cluster (Kind or Minikube) or test EKS cluster. Reference: [FORGE_AGENT_ARCHITECTURE.md](./FORGE_AGENT_ARCHITECTURE.md).

* **Tasks:**
  1. **Agent Skeleton:** Author `cmd/forge-agent/main.go` and `pkg/agent/`.
  2. **eBPF Socket Observer:** Implement socket tracepoints using `cilium/ebpf` (`ebpf-go`):
     * Hook `tracepoint:sock:inet_sock_set_state` and `kprobe:tcp_v4_connect`.
     * Extract source/destination IP:Port, namespace, socket cookie, and handshake latency.
     * Dual-buffer support: `bpf_ring_buffer` with `perf_event_array` fallback.
  3. **TMM DPDK Harvester:** Implement local socket reader polling `/var/run/tmm/tmctl.sock` or in-pod sidecar to extract ring descriptor occupancy and drops.
  4. **gRPC Transport & Spooling:** Implement `grpcTransport` streaming to localhost `forge-ingest:17543` with embedded `bbolt` disk-spool fallback (`/var/lib/forge-agent/spool.db`).

---

### Milestone 4: Strangler Integration in FastAPI
**Goal:** Seamlessly switch UI dashboards and API reads between the legacy Direct pull engine and the new push data pipeline.

* **Tasks:**
  1. **Cluster Data Provider Facade:** Create `backend/services/cluster_provider.py`:
     ```python
     class ClusterDataProvider:
         def get_cluster_telemetry(self, cluster_id: str):
             if self.has_active_agent(cluster_id):
                 # PUSH PATH: Query ClickHouse analytical metrics
                 return self.clickhouse_client.query_pod_traffic(cluster_id)
             else:
                 # FALLBACK PULL PATH: Query legacy Redis/Postgres cache
                 return self.legacy_direct_service.get_telemetry(cluster_id)
     ```
  2. **Heartbeat Registration:** Agent heartbeats update cluster connectivity status in PostgreSQL (`connection_mode = "AGENT_PUSH"`, `last_heartbeat_at = NOW()`).
  3. **UI Transparency:** Verify that existing Next.js frontend cluster detail views seamlessly display real-time ClickHouse metrics when an agent is connected.

---

### Milestone 5: Celery Retirement & Task Migration
**Goal:** Decommission Celery and Redis completely from `docker-compose.yml`. Reference: [DATA_PLATFORM.md](./DATA_PLATFORM.md).

* **Tasks:**
  1. **NATS JetStream WorkQueues:** Create `FORGE_TASKS` stream in NATS JetStream.
  2. **Worker Migration:** Replace Celery worker code with lightweight Go or Python JetStream pull consumers for regular tasks (cluster health scans, configuration reconciliation).
  3. **K8s Job Controller:** Implement `backend/services/k8s_job_service.py`:
     * Replaces long-running Celery worker tasks (QKView bundle generation and `aiperf` benchmark runs) with Ephemeral Kubernetes Jobs (`batch/v1`).
  4. **Compose Cleanup:** Remove `celery-worker-1`, `celery-worker-2`, `celery-beat`, and `redis` from `docker-compose.yml`.

---

### Milestone 6: PoV Packaging, Dual Transport & Air-Gap Licensing
**Goal:** Package the platform for enterprise customer PoVs (Viettel, Yotta, NPCI).

* **Tasks:**
  1. **NATS Leaf Transport:** Implement `natsTransport` in `forge-agent` leveraging native NATS JetStream edge-to-core store-and-forward replication.
  2. **Offline Ed25519 Licensing:**
     * Embed public Ed25519 key in FastAPI backend and Ingest Gateway.
     * Implement license verification service checking `forge.lic` offline with 30-day grace period and clock-drift tolerance.
  3. **Helm Charts:** Author production charts in `deployments/charts/`:
     * `forge-agent`: DaemonSet with `coordination.k8s.io` Lease Leader Election.
     * `forge-console`: Control plane, Ingest Gateway, ClickHouse, Postgres, NATS.
  4. **Air-Gap Bundle (`forgectl`):** Author CLI script to export, mirror, and verify offline container images for customer private registries (Harbor, Artifactory).

---

## 4. Localhost Verification & Test Commands

### 4.1 Milestone 1 (Atlas Cutover Verification)
```bash
# Verify Atlas inspect matches database
atlas schema diff --from "postgres://forge:secret@localhost:5432/forge?sslmode=disable" --to "file://backend/schema/schema.hcl"

# Verify fresh install idempotency
docker compose down -v
docker compose up -d postgres
atlas schema apply -u "postgres://forge:secret@localhost:5432/forge?sslmode=disable" --to "file://backend/schema/schema.hcl" --auto-approve
python3 -m backend.seeds.seed_runner
```

### 4.2 Milestone 2 (Ingest Gateway & ClickHouse Verification)
```bash
# Verify ClickHouse is healthy
curl -s "http://localhost:8123/ping"

# Run Ingest Gateway locally
go run cmd/forge-ingest/main.go --config config/ingest-local.yaml

# Ingest test protobuf batch and verify ClickHouse row count
clickhouse-client --query "SELECT count() FROM forge.ebpf_socket_flows"
```

### 4.3 Milestone 3 (Forge Agent Verification)
```bash
# Run agent unit tests
cd cmd/forge-agent && go test -v -race ./...

# Run agent locally pointing to local Kind cluster
./bin/forge-agent --server localhost:17543 --insecure-skip-tls-verify
```
