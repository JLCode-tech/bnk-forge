"""
Unit and Integration tests for ClusterDataProvider facade, ClickHouseClient,
agent heartbeat synchronization, and Strangulation telemetry endpoints (Milestone 4).
"""

import datetime
from typing import Any
from unittest.mock import MagicMock

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import models  # noqa: F401 - registers all database tables
from database import Base, get_db
from main import app
from models import Project, User
from models.kubernetes import KubernetesCluster
from models.operator import ConnectedOperator
from routes.auth import get_current_user, require_viewer
from services.auth_service import create_access_token
from services.clickhouse_client import ClickHouseClient
from services.cluster_provider import AGENT_HEARTBEAT_THRESHOLD_SECONDS, ClusterDataProvider

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def db_session():
    """Isolated SQLite database session for unit testing."""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine)
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def test_project(db_session):
    project = Project(
        name="Telemetry-Test-Project",
        description="Tenancy scope for telemetry tests",
    )
    db_session.add(project)
    db_session.commit()
    db_session.refresh(project)
    return project


@pytest.fixture
def test_user(db_session):
    user = User(
        username="operator_user",
        email="operator@test.local",
        hashed_password="hashedpassword",
        role="operator",
        is_active=True,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


@pytest.fixture
def mock_clickhouse_transport():
    """Mock HTTP transport returning synthetic ClickHouse JSON responses."""
    def handler(request: httpx.Request) -> httpx.Response:
        url_str = str(request.url)
        query = request.url.params.get("query", "")

        # Route by query contents
        if "forge.tmm_dpdk_metrics" in query:
            data = [{
                "total_rx_packets": 1500000,
                "total_tx_packets": 1495000,
                "total_rx_bytes": 1024000000,
                "total_tx_bytes": 1018000000,
                "total_rx_drops": 12,
                "total_tx_drops": 5,
                "avg_rx_ring_occupancy": 0.285,
                "avg_tx_ring_occupancy": 0.210,
                "avg_cpu_utilization_pct": 34.5,
                "max_hugepage_used_bytes": 2147483648,
            }]
            return httpx.Response(200, json={"data": data, "rows": 1})

        elif "GROUP BY namespace, pod_name" in query:
            data = [
                {
                    "namespace": "production",
                    "pod_name": "ai-inference-worker-7b9",
                    "flow_count": 450,
                    "total_bytes": 85000000,
                    "bytes_sent": 40000000,
                    "bytes_received": 45000000,
                    "bypass_violations": 1,
                },
                {
                    "namespace": "ingress-f5",
                    "pod_name": "f5-tmm-gateway-0",
                    "flow_count": 1200,
                    "total_bytes": 250000000,
                    "bytes_sent": 125000000,
                    "bytes_received": 125000000,
                    "bypass_violations": 0,
                },
            ]
            return httpx.Response(200, json={"data": data, "rows": 2})

        elif "AND tmm_bypass_violation = 1" in query:
            data = [{
                "timestamp": "2026-11-16T05:00:00Z",
                "node_name": "worker-k8s-01",
                "pod_name": "ai-inference-worker-7b9",
                "namespace": "production",
                "src_ip": "10.244.1.45",
                "src_port": 45120,
                "dst_ip": "10.244.2.80",
                "dst_port": 8000,
                "direction": "INBOUND",
                "handshake_duration_us": 450,
            }]
            return httpx.Response(200, json={"data": data, "rows": 1})

        elif "count() AS total_flows" in query or "forge.ebpf_socket_flows" in query:
            data = [{
                "total_flows": 12450,
                "inbound_flows": 6200,
                "outbound_flows": 6250,
                "total_bytes_sent": 524000000,
                "total_bytes_received": 512000000,
                "avg_handshake_duration_us": 124.5,
                "avg_smoothed_rtt_us": 312.0,
                "total_retransmissions": 8,
                "tmm_bypass_violations": 1,
            }]
            return httpx.Response(200, json={"data": data, "rows": 1})

        return httpx.Response(200, json={"data": [], "rows": 0})

    transport = httpx.MockTransport(handler)
    client = httpx.Client(transport=transport, base_url="http://mock-clickhouse:8123")
    return ClickHouseClient(base_url="http://mock-clickhouse:8123", client=client)


# ---------------------------------------------------------------------------
# Test Cases
# ---------------------------------------------------------------------------

class TestClickHouseClient:
    """Verify analytical ClickHouse client queries and fallback resilience."""

    def test_query_flows_summary(self, mock_clickhouse_transport):
        ch = mock_clickhouse_transport
        res = ch.query_flows_summary("550e8400-e29b-41d4-a716-446655440000", hours=2)
        assert res["total_flows"] == 12450
        assert res["inbound_flows"] == 6200
        assert res["tmm_bypass_violations"] == 1
        assert res["avg_handshake_duration_us"] == 124.5

    def test_query_top_pod_talkers(self, mock_clickhouse_transport):
        ch = mock_clickhouse_transport
        talkers = ch.query_top_pod_talkers("550e8400-e29b-41d4-a716-446655440000", hours=1)
        assert len(talkers) == 2
        assert talkers[0]["pod_name"] == "ai-inference-worker-7b9"
        assert talkers[0]["total_bytes"] == 85000000

    def test_query_tmm_metrics_summary(self, mock_clickhouse_transport):
        ch = mock_clickhouse_transport
        tmm = ch.query_tmm_metrics_summary("550e8400-e29b-41d4-a716-446655440000", hours=1)
        assert tmm["total_rx_packets"] == 1500000
        assert tmm["avg_cpu_utilization_pct"] == 34.5
        assert tmm["total_rx_drops"] == 12

    def test_query_drift_violations(self, mock_clickhouse_transport):
        ch = mock_clickhouse_transport
        drift = ch.query_drift_violations("550e8400-e29b-41d4-a716-446655440000", hours=24)
        assert len(drift) == 1
        assert drift[0]["pod_name"] == "ai-inference-worker-7b9"
        assert drift[0]["dst_port"] == 8000
        assert "bypassed BNK TMM" in drift[0]["message"]

    def test_offline_clickhouse_resilience(self):
        """When ClickHouse HTTP returns an error, client gracefully returns default zeroes."""
        def error_handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(500, text="Internal Server Error: DB down")

        transport = httpx.MockTransport(error_handler)
        offline_ch = ClickHouseClient(client=httpx.Client(transport=transport))

        flows = offline_ch.query_flows_summary("550e8400-e29b-41d4-a716-446655440000")
        assert flows["total_flows"] == 0
        assert flows["tmm_bypass_violations"] == 0

        tmm = offline_ch.query_tmm_metrics_summary("550e8400-e29b-41d4-a716-446655440000")
        assert tmm["total_rx_packets"] == 0


class TestClusterDataProviderFacade:
    """Verify Strangler pattern dynamic switching between Agent Push and Legacy Pull."""

    def test_has_active_agent_false_on_fresh_direct_cluster(self, db_session, test_project, mock_clickhouse_transport):
        cluster = KubernetesCluster(
            name="direct-eks-cluster",
            context="arn:aws:eks:us-west-2:123456789012:cluster/direct-eks",
            project_id=test_project.id,
            access_method="kubeconfig",
            connectivity_status="connected",
        )
        db_session.add(cluster)
        db_session.commit()

        provider = ClusterDataProvider(db_session, clickhouse_client=mock_clickhouse_transport)
        assert provider.has_active_agent(cluster) is False

    def test_has_active_agent_true_when_agent_heartbeats(self, db_session, test_project, mock_clickhouse_transport):
        cluster = KubernetesCluster(
            name="enrolled-agent-cluster",
            context="forge-agent-enrolled",
            project_id=test_project.id,
            access_method="agent_push",
            integration_status="agent_connected",
            connectivity_status="connected",
            last_synced_at=datetime.datetime.now(datetime.UTC),
            meta_data={"cluster_uuid": "550e8400-e29b-41d4-a716-446655440000"},
        )
        db_session.add(cluster)
        db_session.commit()

        operator = ConnectedOperator(
            operator_id="agent-01-node",
            cluster_name=cluster.name,
            cluster_id=cluster.id,
            connectivity_mode="mtls_agent",
            is_connected=True,
            last_connected_at=datetime.datetime.now(datetime.UTC),
            last_heartbeat_at=datetime.datetime.now(datetime.UTC),
            status="active",
        )
        db_session.add(operator)
        db_session.commit()

        provider = ClusterDataProvider(db_session, clickhouse_client=mock_clickhouse_transport)
        assert provider.has_active_agent(cluster) is True

    def test_has_active_agent_stale_heartbeat_falls_back(self, db_session, test_project, mock_clickhouse_transport):
        stale_time = datetime.datetime.now(datetime.UTC) - datetime.timedelta(seconds=200)
        cluster = KubernetesCluster(
            name="stale-cluster",
            context="forge-agent-stale",
            project_id=test_project.id,
            access_method="agent_push",
            last_synced_at=stale_time,
        )
        db_session.add(cluster)
        db_session.commit()

        operator = ConnectedOperator(
            operator_id="agent-stale",
            cluster_name=cluster.name,
            cluster_id=cluster.id,
            connectivity_mode="mtls_agent",
            is_connected=True,
            last_heartbeat_at=stale_time,
            status="active",
        )
        db_session.add(operator)
        db_session.commit()

        provider = ClusterDataProvider(db_session, clickhouse_client=mock_clickhouse_transport)
        assert provider.has_active_agent(cluster) is False

    def test_record_agent_heartbeat_updates_state(self, db_session, test_project, mock_clickhouse_transport):
        cluster = KubernetesCluster(
            name="heartbeat-cluster",
            context="forge-agent-hb",
            project_id=test_project.id,
            access_method="agent_push",
            connectivity_status="unknown",
            meta_data={"cluster_uuid": "c0ffee00-e29b-41d4-a716-446655440000"},
        )
        db_session.add(cluster)
        db_session.commit()

        provider = ClusterDataProvider(db_session, clickhouse_client=mock_clickhouse_transport)
        res = provider.record_agent_heartbeat(
            cluster_ident=cluster.id,
            node_name="worker-01",
            agent_id="agent-hb-01",
            status="healthy",
            uptime_seconds=360,
        )
        assert res["status"] == "recorded"
        assert res["is_connected"] is True

        db_session.refresh(cluster)
        assert cluster.connectivity_status == "connected"
        assert cluster.integration_status == "agent_connected"
        assert cluster.access_method == "agent_push"

        op = db_session.query(ConnectedOperator).filter(ConnectedOperator.cluster_id == cluster.id).first()
        assert op is not None
        assert op.is_connected is True
        assert op.uptime_seconds == 360

    def test_strangler_telemetry_routing_push_path(self, db_session, test_project, mock_clickhouse_transport):
        """When agent is active, get_cluster_telemetry routes to ClickHouse (AGENT_PUSH)."""
        cluster = KubernetesCluster(
            name="active-push-cluster",
            context="ctx",
            project_id=test_project.id,
            access_method="agent_push",
            integration_status="agent_connected",
            connectivity_status="connected",
            last_synced_at=datetime.datetime.now(datetime.UTC),
            meta_data={"cluster_uuid": "550e8400-e29b-41d4-a716-446655440000"},
        )
        db_session.add(cluster)
        db_session.commit()

        op = ConnectedOperator(
            operator_id="agent-op",
            cluster_name=cluster.name,
            cluster_id=cluster.id,
            is_connected=True,
            last_heartbeat_at=datetime.datetime.now(datetime.UTC),
            status="active",
        )
        db_session.add(op)
        db_session.commit()

        provider = ClusterDataProvider(db_session, clickhouse_client=mock_clickhouse_transport)
        telemetry = provider.get_cluster_telemetry(cluster.id, hours=1)

        assert telemetry["source"] == "AGENT_PUSH"
        assert telemetry["status"] == "active"
        assert telemetry["has_active_agent"] is True
        assert telemetry["flows"]["total_flows"] == 12450
        assert telemetry["tmm"]["total_rx_packets"] == 1500000
        assert telemetry["drift_violations_count"] == 1

    def test_strangler_telemetry_routing_fallback_pull_path(self, db_session, test_project, mock_clickhouse_transport):
        """When agent is not connected, get_cluster_telemetry routes to fallback (LEGACY_PULL)."""
        cluster = KubernetesCluster(
            name="legacy-pull-cluster",
            context="ctx-legacy",
            project_id=test_project.id,
            access_method="kubeconfig",
            connectivity_status="reachable",
            node_count=3,
        )
        db_session.add(cluster)
        db_session.commit()

        provider = ClusterDataProvider(db_session, clickhouse_client=mock_clickhouse_transport)
        telemetry = provider.get_cluster_telemetry(cluster.id, hours=1)

        assert telemetry["source"] == "LEGACY_PULL"
        assert telemetry["status"] == "reachable"
        assert telemetry["has_active_agent"] is False
        assert telemetry["flows"] is None
        assert telemetry["tmm"] is None
        assert telemetry["drift_violations_count"] == 0
        assert telemetry["node_count"] == 3


# ---------------------------------------------------------------------------
# HTTP Route Integration Tests
# ---------------------------------------------------------------------------

class TestStranglerTelemetryRoutes:
    """Verify HTTP API endpoints for telemetry and heartbeat synchronization."""

    def test_agent_heartbeat_route_public(self, db_session, test_project):
        """Verify agent heartbeat endpoint functions without human JWT (AGENT_PUBLIC_ENDPOINTS)."""
        cluster = KubernetesCluster(
            name="api-hb-cluster",
            context="ctx-api",
            project_id=test_project.id,
            access_method="agent_push",
            meta_data={"cluster_uuid": "770e8400-e29b-41d4-a716-446655440000"},
        )
        db_session.add(cluster)
        db_session.commit()

        app.dependency_overrides[get_db] = lambda: db_session
        try:
            client = TestClient(app)
            payload = {
                "cluster_id": str(cluster.id),
                "node_name": "k8s-node-01",
                "agent_id": "agent-770e",
                "status": "healthy",
                "uptime_seconds": 120,
            }
            # Unauthenticated POST (no user Bearer token)
            resp = client.post("/api/fleet/enrollment/agent-heartbeat", json=payload)
            assert resp.status_code == 200
            data = resp.json()
            assert data["status"] == "recorded"
            assert data["cluster_id"] == cluster.id
            assert data["is_connected"] is True
        finally:
            app.dependency_overrides.pop(get_db, None)

    def test_telemetry_summary_route(self, db_session, test_project, test_user, mock_clickhouse_transport, monkeypatch):
        """Verify GET /api/k8s/clusters/{id}/telemetry/summary."""
        monkeypatch.setattr("services.auth_service.token_user_state", lambda t: test_user)
        cluster = KubernetesCluster(
            name="api-summary-cluster",
            context="ctx-summary",
            project_id=test_project.id,
            access_method="agent_push",
            integration_status="agent_connected",
            connectivity_status="connected",
            last_synced_at=datetime.datetime.now(datetime.UTC),
            meta_data={"cluster_uuid": "550e8400-e29b-41d4-a716-446655440000"},
        )
        db_session.add(cluster)
        db_session.commit()

        op = ConnectedOperator(
            operator_id="agent-summary",
            cluster_name=cluster.name,
            cluster_id=cluster.id,
            is_connected=True,
            last_heartbeat_at=datetime.datetime.now(datetime.UTC),
            status="active",
        )
        db_session.add(op)
        db_session.commit()

        app.dependency_overrides[get_db] = lambda: db_session
        app.dependency_overrides[require_viewer] = lambda: test_user
        app.dependency_overrides[get_current_user] = lambda: test_user

        # Inject mock ClickHouse into provider
        from routes.k8s import telemetry as telemetry_module
        orig_init = ClusterDataProvider.__init__
        def patched_init(self, db, clickhouse_client=None):
            orig_init(self, db, clickhouse_client=mock_clickhouse_transport)

        ClusterDataProvider.__init__ = patched_init

        auth_token = create_access_token(data={"sub": test_user.username, "role": test_user.role})
        headers = {"Authorization": f"Bearer {auth_token}"}

        try:
            client = TestClient(app)
            resp = client.get(
                f"/api/k8s/clusters/{cluster.id}/telemetry/summary",
                headers=headers,
            )
            assert resp.status_code == 200
            data = resp.json()
            assert data["source"] == "AGENT_PUSH"
            assert data["has_active_agent"] is True
            assert data["flows"]["total_flows"] == 12450
            assert data["tmm"]["total_rx_packets"] == 1500000

            # Test flows sub-route
            flows_resp = client.get(
                f"/api/k8s/clusters/{cluster.id}/telemetry/flows",
                headers=headers,
            )
            assert flows_resp.status_code == 200
            flows_data = flows_resp.json()
            assert flows_data["source"] == "AGENT_PUSH"
            assert len(flows_data["top_talkers"]) == 2

            # Test drift sub-route
            drift_resp = client.get(
                f"/api/k8s/clusters/{cluster.id}/telemetry/drift",
                headers=headers,
            )
            assert drift_resp.status_code == 200
            drift_data = drift_resp.json()
            assert drift_data["source"] == "AGENT_PUSH"
            assert drift_data["count"] == 1
        finally:
            ClusterDataProvider.__init__ = orig_init
            app.dependency_overrides.pop(get_db, None)
            app.dependency_overrides.pop(require_viewer, None)
            app.dependency_overrides.pop(get_current_user, None)
