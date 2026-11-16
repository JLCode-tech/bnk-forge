# BNK Forge Architecture

> **Current state:** CI-gated multi-phase suite | Python-defined BNK modules + library sync | 3 execution engines

This directory contains architecture decisions, technical design docs, and the roadmap for BNK Forge v2.

## Active Documents

**Document status legend:**
- **Current** — matches the active product architecture and roadmap
- **Historical** — useful context from earlier phases; may describe superseded designs
- **Superseded** — retained for traceability; replaced by newer decisions

| Document | Description |
|---|---|
| [**DEPLOYMENT_MODELS_AND_PREREQUISITES.md**](./DEPLOYMENT_MODELS_AND_PREREQUISITES.md) | *(Current - v1.0.0-pov)* Customer prerequisites, VM/K8s/SaaS console deployment models, and console-driven agent enrollment |
| [**POV_MIGRATION_PLAN.md**](./POV_MIGRATION_PLAN.md) | *(Current - v1.0.0-pov)* Phased migration plan to move Forge 4.3.3 localhost Docker-Compose to target architecture |
| [**FORGE_AGENT_ARCHITECTURE.md**](./FORGE_AGENT_ARCHITECTURE.md) | *(Current - v1.0.0-pov)* Edge Go Agent, socket-layer eBPF, TMM DPDK enrichment, and dual transport |
| [**DATA_PLATFORM.md**](./DATA_PLATFORM.md) | *(Current - v1.0.0-pov)* ClickHouse time-series, NATS JetStream WorkQueues, and K8s Job patterns |
| [**SCHEMA_MANAGEMENT.md**](./SCHEMA_MANAGEMENT.md) | *(Current - v1.0.0-pov)* Atlas declarative schema runbook and Alembic 163-migration retirement |
| [**../PRODUCT_VISION.md**](../PRODUCT_VISION.md) | *(Current)* Product direction and strategic priorities |
| [**../ROADMAP.md**](../ROADMAP.md) | *(Current)* Platform roadmap and milestones |
| [CUSTOMER_PRODUCT_VISION.md](./CUSTOMER_PRODUCT_VISION.md) | *(Historical)* Original product direction analysis |

## Architecture Overview


```
┌──────────────────────────────────────────────────────────────────────┐
│  BNK-FORGE (Control Plane)                                          │
│  Docker Compose: postgres, redis, backend, celery, frontend, proxy  │
│                                                                     │
│  ┌──────────┐ ┌────────┐ ┌──────────────────────────────────────┐  │
│  │ FastAPI   │ │ React  │ │ Engines                              │  │
│  │ API + WS  │ │ UI     │ │ ├─ OpenTofu     (local, cloud infra) │  │
│  │           │ │        │ │ ├─ K8s Direct   (remote, via kube)   │  │
│  │           │ │        │ │ └─ Operator     (remote, via WS)     │  │
│  └──────────┘ └────────┘ └──────────────────────────────────────┘  │
│                                                                     │
└─────────────────────────┬───────────────────┬───────────────────────┘
                          │                   │
          MODEL A: Direct (primary)           MODEL B: Operator (optional)
          (BNK Forge reaches out              (phones home via WS —
           via kubeconfig)                     for outbound-only envs)
```

Three engines, two connectivity models, same UI and modules.
Kubeconfig-first (Direct) is the primary path — see Decision D3.
