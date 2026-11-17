"""Unit tests for tasks.telemetry_pull_task."""

from __future__ import annotations

import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch


def test_pull_pod_batches_decodes_json():
    from tasks.telemetry_pull_task import _pull_pod_batches

    api_client = MagicMock()
    payload = json.dumps({"batches": [{"batch_id": "b1", "flows": []}]}).encode("utf-8")
    api_client.call_api.return_value = SimpleNamespace(data=payload)

    batches = _pull_pod_batches(api_client, "forge-agent-abc")
    assert len(batches) == 1
    assert batches[0]["batch_id"] == "b1"
    api_client.call_api.assert_called_once()
    call_path = api_client.call_api.call_args[0][0]
    assert call_path == "/api/v1/namespaces/forge-system/pods/forge-agent-abc:17544/proxy/api/v1/telemetry/pull"


def test_pull_cluster_agent_telemetry_forwards_to_ingest():
    from tasks.telemetry_pull_task import pull_cluster_agent_telemetry

    fake_cluster = SimpleNamespace(id=1, name="aks-poc", is_active=True, last_synced_at=None)
    fake_db = MagicMock()
    fake_db.query.return_value.all.return_value = [fake_cluster]
    fake_db.query.return_value.filter.return_value.first.return_value = None

    fake_pod = SimpleNamespace(
        metadata=SimpleNamespace(name="forge-agent-xyz"),
        status=SimpleNamespace(phase="Running"),
    )
    fake_api_client = MagicMock()
    fake_api_client.call_api.return_value = SimpleNamespace(
        data=json.dumps({"batches": [{"batch_id": "b-1"}]}).encode("utf-8")
    )

    fake_http = MagicMock()
    fake_http.__enter__.return_value = fake_http
    fake_http.post.return_value = SimpleNamespace(status_code=202, text="accepted")

    with (
        patch("tasks.telemetry_pull_task.SessionLocal", return_value=fake_db),
        patch("services.kubernetes_service.KubernetesService") as mock_k8s_svc,
        patch("kubernetes.client.CoreV1Api") as mock_core_v1,
        patch("tasks.telemetry_pull_task.httpx.Client", return_value=fake_http),
    ):
        mock_k8s_svc.return_value.load_kubeconfig.return_value = fake_api_client
        mock_core_v1.return_value.list_namespaced_pod.return_value = SimpleNamespace(items=[fake_pod])
        res = pull_cluster_agent_telemetry()

    assert res == {"clusters_polled": 1, "pulled_batches": 1}
    fake_http.post.assert_called_once()
    assert fake_cluster.last_synced_at is not None
