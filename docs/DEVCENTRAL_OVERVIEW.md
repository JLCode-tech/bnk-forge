# F5 BIG-IP Next for Kubernetes (BNK) Management with BNK Forge

## Technical Architecture & Operations Reference

> Technical reference documentation for platform engineers, network architects, SREs, and F5 support engineers operating F5 BIG-IP Next for Kubernetes (BNK) with BNK Forge 4.0.0 and [`bnkctl`](https://github.com/JLCode-tech/bnkctl).

---

## 1. Architecture Overview

**F5 BIG-IP Next for Kubernetes (BNK)** provides high-performance L4–L7 ingress, hardware acceleration, application security policies, and the **F5 BNK AI Service Plane** in cloud-native Kubernetes environments. See the [F5 BIG-IP Next for Kubernetes CloudDocs](https://clouddocs.f5.com/bigip-next-for-kubernetes/latest/overview.html) for complete product documentation.

**BNK Forge 4.0.0** is an orchestration and visual management plane built for F5 BNK deployments across **releases 2.2, 2.3, 2.4, and 2.5**. It manages the full lifecycle of BNK infrastructure:
- Automated multi-cloud blueprint deployment across AWS EKS, Azure AKS, Google Cloud GKE, Red Hat OpenShift, IBM Cloud ROKS, and bare-metal environments (including turnkey integration with [`bnkctl`](https://github.com/JLCode-tech/bnkctl)).
- Declarative Kubernetes Gateway API and F5 BNK policy topology visualization and editing.
- Multi-cloud **F5 BNK AI Service Plane** governance: token accounting, budget/rate limits, PII/DLP guardrails, and Smart LLM Routing across AWS Bedrock, Azure AI Foundry, and Google Vertex AI.
- Multi-cluster fleet synchronization, drift detection, and configuration promotion.
- Integrated Day 2 diagnostics: CWC QKView export and live runtime state inspection.
- Performance benchmarking for standard ingress and LLM inference workloads (`aiperf` + 15 validation scenarios).
- Programmatic fleet operations via 200+ REST endpoints and **153 Model Context Protocol (MCP) tools**.

![BNK Forge Multi-Cloud Platform Overview](images/forge-platform-overview.png)

---

## 2. Version Compatibility Matrix

| BNK Forge Release | Supported F5 BNK Releases | Module Library Ref | Gateway API Version | Kubernetes Versions | Support Status |
|---|---|---|---|---|---|
| **4.0.0** | **2.2, 2.3, 2.4, 2.5** | `release/4.0` | v1.1+ (Standard Channel) | 1.28 – 1.32 | **Active (Current Release)** |
| 3.x | 2.2, 2.3 | `release/2.2` | v1.0+ | 1.26 – 1.30 | Maintained |
| 2.x | 2.2 | `release/2.2` | v1.0 | 1.24 – 1.28 | Legacy |

---

## 3. Kubernetes Gateway API & F5 BNK Data Plane Capabilities

BNK Forge manages declarative Kubernetes Gateway API and F5 BNK resources across connected clusters.

### Supported Capabilities
- **Standard Gateway API**: L4–L7 ingress, TLS termination, HTTP/gRPC/TCP/UDP routing (`GatewayClass`, `Gateway`, `HTTPRoute`, `GRPCRoute`, `TCPRoute`, `UDPRoute`, `TLSRoute`).
- **F5 BNK Network & Security Policies**: Zero-trust L4/L7 traffic filtering, carrier-grade network translation, DNS delivery, DDoS mitigation, and programmable traffic inspection. See the [F5 BIG-IP Next for Kubernetes CloudDocs](https://clouddocs.f5.com/bigip-next-for-kubernetes/latest/overview.html) for full platform details.
- **F5 BNK AI Service Plane**: Multi-cloud AI token governance, rate and budget enforcement, PII/DLP guardrails, and weighted Smart LLM Routing across AWS Bedrock, Azure AI Foundry, and Google Vertex AI.
- **Hardware Acceleration**: Data Plane Function (DPF) / NVIDIA BlueField-3 SmartNIC configuration and offload.

![BNK Visual Policy Builder](images/forge-bnk-policy-builder.png)

---

## 4. Multi-Cluster Fleet Governance & Configuration Promotion

Managing configurations across development, staging, and production clusters requires strict change tracking and drift detection.

![Unified Multi-Cloud Cluster Fleet](images/forge-multi-cloud-cluster-fleet.png)

### Technical Workflow
1. **Direct Kubeconfig or `bnkctl` Integration**: Connects to the standard Kubernetes API server of target clusters using RBAC credentials or automatic registration via `bnkctl up`. No in-cluster agent is required.
2. **Configuration Snapshots**: Captures point-in-time declarative manifests of BNK and Gateway API resources in JSON/YAML format.
3. **Semantic Diffing**: Computes deep diffs between clusters, identifying modified, missing, and extra resources while filtering cluster-specific metadata (e.g. `uid`, `resourceVersion`, timestamps).
4. **Selective Promotion**: Promotes individual routes, security policies, or full stacks with single-click execution.
5. **Drift Detection**: Background Celery workers regularly poll target clusters to detect and alert on out-of-band modifications.

---

## 5. Day 2 Diagnostics & Runtime Inspection

BNK Forge provides built-in diagnostic tools for operators and TAC support engineers to inspect runtime state and export diagnostic bundles:
- **1-Click QKView Extraction**: Gathers the complete BNK diagnostic tarball directly from the Cloud Workspace Controller (CWC) API. Archives can be downloaded locally or forwarded to F5 iHealth.
- **Live Data-Plane Inspection**: Queries statistical tables, hardware counters, compiled runtime state, ARP tables, and active Layer 4 connection state directly through the web console without requiring SSH access to host nodes.
- **Automated Runbooks**: Scripted diagnostic tests that verify DNS connectivity, CWC certificate validity, controller reconciliation loops, and worker node health.

---

## 6. F5 BNK AI Service Plane & GenAI Benchmarking

BNK Forge includes a dedicated benchmark and observability suite to evaluate AI token governance, Smart LLM routing, throughput, and latency under concurrent load.

![Multi-Cloud AI Token Governance Overview](images/forge-ai-token-governance-overview.png)

![Multi-Stack Benchmark Dashboard](images/forge-benchmark-dashboard.png)

### Measured Parameters
- **Time-To-First-Token (TTFT)**: Measures prompt-processing latency percentiles (p50, p95, p99) under varying levels of concurrency.
- **Streaming Throughput**: Evaluates token generation rates (output tokens/sec) and connection reuse efficiency.
- **Concurrency Scaling**: Maps performance degradation curves as concurrent client sessions increase.
- **Policy Verification**: Compares benchmark performance before and after applying F5 BNK security policies and **F5 BNK AI Service Plane** routing rules.

---

## 7. Model Context Protocol (MCP) Architecture

BNK Forge provides a dedicated **Model Context Protocol (MCP)** server on port 8081, exposing **153 tools** for programmatic inspection and operations via AI assistants (Anthropic Claude, Google Antigravity) or custom automation engines.

![BNK Forge MCP Server Tools](images/forge-mcp-server-tools.png)

### Risk Classification Model
- **`READ_ONLY`**: Telemetry collection, topology queries, health checks, log inspection. Executed without confirmation.
- **`MUTATE`**: Route application, policy attachment, blueprint deployment. Requires Operator-level credentials.
- **`DESTRUCTIVE`**: Cluster removal, resource deletion, rollback execution. Requires explicit Administrator confirmation.
- **Audit Logging**: All MCP requests and tool invocations are logged with the initiating identity, timestamp, and full execution payload.

---

## 8. Operational Reference & Verification

### Common Platform Management Commands

| Command | Action |
|---|---|
| `make local-deploy` | Build and start all platform containers on macOS / WSL2 |
| `make deploy` | Build and start production stack on Linux host |
| `make status` | Check runtime status and health of all platform containers |
| `make upgrade-safe` | Execute non-destructive platform upgrade with health pre-checks |
| `make mcp-readiness` | Verify MCP service status and tool availability |
| `make test` | Run platform test suite (backend, frontend, proxy, operator) |

### API Documentation
Interactive OpenAPI documentation (Swagger UI) is available at:
```
https://<forge-host>/docs
```
Raw OpenAPI JSON specification is accessible at:
```
https://<forge-host>/openapi.json
```
