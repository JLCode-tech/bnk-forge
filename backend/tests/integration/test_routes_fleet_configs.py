"""Integration tests for Fleet Deployable Configs API."""

from unittest.mock import MagicMock, patch
import pytest
from starlette.testclient import TestClient

from models.fleet_config import FleetDeployableConfig
from models.fleet_targeting import FleetTarget
from models.kubernetes import KubernetesCluster
from services.auth_service import create_access_token
from tests.factories import UserFactory


def _token_for(user) -> dict:
    token = create_access_token(data={"sub": user.username})
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def operator_user(db):
    return UserFactory(db, role="operator", is_active=True)


@pytest.fixture
def viewer_user(db):
    return UserFactory(db, role="viewer", is_active=True)


SAMPLE_YAML = """apiVersion: v1
kind: ConfigMap
metadata:
  name: fleet-test-cm
  namespace: default
data:
  managed-by: bnk-fleet
"""


def test_create_and_get_fleet_config(client: TestClient, operator_user):
    headers = _token_for(operator_user)
    payload = {
        "name": "Standard Ingress Route",
        "description": "Base route for fleet",
        "category": "routing",
        "target_namespace": "default",
        "config_yaml": SAMPLE_YAML,
    }
    resp = client.post("/api/fleet/configs", json=payload, headers=headers)
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["name"] == "Standard Ingress Route"
    assert data["category"] == "routing"
    assert data["created_by"] == operator_user.username
    config_id = data["id"]

    # Get by ID
    get_resp = client.get(f"/api/fleet/configs/{config_id}", headers=headers)
    assert get_resp.status_code == 200
    assert get_resp.json()["id"] == config_id


def test_list_and_filter_fleet_configs(client: TestClient, db, operator_user):
    headers = _token_for(operator_user)

    c1 = FleetDeployableConfig(
        name="Global Config 1",
        config_yaml=SAMPLE_YAML,
        category="routing",
        created_by=operator_user.username,
    )
    c2 = FleetDeployableConfig(
        name="Security Policy 1",
        config_yaml=SAMPLE_YAML,
        category="security",
        created_by=operator_user.username,
    )
    db.add_all([c1, c2])
    db.commit()

    resp = client.get("/api/fleet/configs", headers=headers)
    assert resp.status_code == 200
    names = [c["name"] for c in resp.json()]
    assert "Global Config 1" in names
    assert "Security Policy 1" in names

    # Filter by category
    resp_filtered = client.get("/api/fleet/configs?category=security", headers=headers)
    assert resp_filtered.status_code == 200
    assert all(c["category"] == "security" for c in resp_filtered.json())


def test_update_and_delete_fleet_config(client: TestClient, db, operator_user):
    headers = _token_for(operator_user)

    c = FleetDeployableConfig(
        name="Original Name",
        config_yaml=SAMPLE_YAML,
        category="custom",
        created_by=operator_user.username,
    )
    db.add(c)
    db.commit()

    # Update
    update_payload = {"name": "Updated Name", "category": "gateway"}
    resp = client.put(f"/api/fleet/configs/{c.id}", json=update_payload, headers=headers)
    assert resp.status_code == 200
    assert resp.json()["name"] == "Updated Name"
    assert resp.json()["category"] == "gateway"

    # Delete
    del_resp = client.delete(f"/api/fleet/configs/{c.id}", headers=headers)
    assert del_resp.status_code == 204

    # Verify 404
    assert client.get(f"/api/fleet/configs/{c.id}", headers=headers).status_code == 404


def test_deploy_fleet_config_dry_run(client: TestClient, db, operator_user):
    headers = _token_for(operator_user)

    cluster = KubernetesCluster(
        name="mock-cluster-1",
        context="ctx-1",
        api_server="https://k8s.example.com",
        status="active",
        default_namespace="default",
    )
    db.add(cluster)
    db.commit()

    payload = {
        "config_yaml": SAMPLE_YAML,
        "target_cluster_ids": [cluster.id],
        "dry_run": True,
    }

    with (
        patch("services.kubernetes_service.KubernetesService.load_kubeconfig") as mock_load,
        patch("services.kubernetes_service.KubernetesService.create_resource") as mock_create,
    ):
        mock_load.return_value = MagicMock()
        mock_create.return_value = {"status": "ok"}

        resp = client.post("/api/fleet/configs/deploy", json=payload, headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["dry_run"] is True
        assert data["total_clusters"] == 1
        assert data["successful_clusters"] == 1
        assert len(data["cluster_results"]) == 1
        assert data["cluster_results"][0]["cluster_id"] == cluster.id
        assert data["cluster_results"][0]["status"] == "ready"


def test_fleet_config_service_db_error_resilience():
    from core.errors import NotFoundError
    from services.fleet_config_service import get_deployable_config, list_deployable_configs

    mock_db = MagicMock()
    mock_db.query.side_effect = Exception("Connection lost or table missing")

    # list_deployable_configs must return [] instead of raising 500
    assert list_deployable_configs(mock_db) == []

    # get_deployable_config must raise NotFoundError (translates to 404)
    with pytest.raises(NotFoundError):
        get_deployable_config(mock_db, 123)
