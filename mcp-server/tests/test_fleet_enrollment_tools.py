"""Tests for push-based fleet enrollment MCP tools."""

from __future__ import annotations

import json
from typing import Any

import pytest

pytest.importorskip("mcp", reason="mcp package not installed in this test environment")

from bnk_forge_mcp.tools.cluster_management import register as register_cluster


class _FakeMCP:
    def __init__(self) -> None:
        self.tools: dict[str, Any] = {}

    def tool(self):
        def decorator(fn):
            self.tools[fn.__name__] = fn
            return fn

        return decorator


class _CapturingClient:
    def __init__(self, response: Any = None) -> None:
        self.calls: list[tuple[str, str, Any, Any]] = []
        self.response = response or {}

    async def get(self, path: str, params=None):
        self.calls.append(("GET", path, params, None))
        return self.response

    async def post(self, path: str, json=None, params=None):
        self.calls.append(("POST", path, params, json))
        return self.response

    async def delete(self, path: str, params=None):
        self.calls.append(("DELETE", path, params, None))
        return self.response


@pytest.mark.asyncio
async def test_mint_fleet_enrollment_token() -> None:
    client = _CapturingClient(
        {
            "id": 1,
            "token": "forge_jwt_123",
            "helm_command": "helm install forge-agent ...",
            "kubectl_command": "kubectl apply -f ...",
        }
    )
    mcp = _FakeMCP()
    register_cluster(mcp, client)

    tool = mcp.tools["mint_fleet_enrollment_token"]
    raw = await tool(
        cluster_name="edge-cluster-1",
        project_id=42,
        cluster_id=10,
        expires_in_hours=48,
        max_uses=2,
        console_url="https://console.example.com:17543",
    )
    res = json.loads(raw)
    assert res["id"] == 1
    assert res["token"] == "forge_jwt_123"

    method, path, params, payload = client.calls[0]
    assert method == "POST"
    assert path == "/api/fleet/enrollment/token"
    assert payload == {
        "cluster_name": "edge-cluster-1",
        "expires_in_hours": 48,
        "max_uses": 2,
        "project_id": 42,
        "cluster_id": 10,
        "console_url": "https://console.example.com:17543",
    }


@pytest.mark.asyncio
async def test_get_fleet_enrollment_status() -> None:
    client = _CapturingClient(
        {
            "cluster_id": 10,
            "cluster_name": "edge-cluster-1",
            "has_active_agent": True,
            "connection_mode": "AGENT_PUSH",
            "connectivity_status": "connected",
        }
    )
    mcp = _FakeMCP()
    register_cluster(mcp, client)

    tool = mcp.tools["get_fleet_enrollment_status"]
    raw = await tool(cluster_id="10")
    res = json.loads(raw)
    assert res["connection_mode"] == "AGENT_PUSH"
    assert res["has_active_agent"] is True

    method, path, _, _ = client.calls[0]
    assert method == "GET"
    assert path == "/api/fleet/enrollment/status/10"


@pytest.mark.asyncio
async def test_list_fleet_enrollment_tokens() -> None:
    client = _CapturingClient([{"id": 1, "token_prefix": "frg_"}])
    mcp = _FakeMCP()
    register_cluster(mcp, client)

    tool = mcp.tools["list_fleet_enrollment_tokens"]
    raw = await tool(project_id=42)
    res = json.loads(raw)
    assert len(res) == 1

    method, path, params, _ = client.calls[0]
    assert method == "GET"
    assert path == "/api/fleet/enrollment/tokens"
    assert params == {"project_id": 42}


@pytest.mark.asyncio
async def test_revoke_fleet_enrollment_token() -> None:
    client = _CapturingClient({"status": "revoked", "id": 5})
    mcp = _FakeMCP()
    register_cluster(mcp, client)

    tool = mcp.tools["revoke_fleet_enrollment_token"]
    raw = await tool(token_id=5)
    res = json.loads(raw)
    assert res["status"] == "revoked"

    method, path, _, _ = client.calls[0]
    assert method == "DELETE"
    assert path == "/api/fleet/enrollment/tokens/5"
