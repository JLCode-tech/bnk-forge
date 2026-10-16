"""Unit tests for agent WebSocket connection-state helpers.

These encode two invariants discovered when the managed agent stayed wedged at
status="disconnected" while its heartbeats kept advancing last_heartbeat:

1. A heartbeat is proof of life — it must reset status to "connected" (or
   "running"), so a stale "disconnected" self-heals instead of failing dispatch
   with AGENT_NOT_CONNECTED forever.
2. On an agent pod restart the new connection overwrites the registry before the
   old handler's teardown runs; the old handler must not clobber the new ws.
"""

import routes.benchmarks as bm
from routes.benchmarks import _owns_agent_connection, _status_for_heartbeat


class TestStatusForHeartbeat:
    def test_plain_heartbeat_maps_to_connected(self):
        # No status field → the old code left status untouched (the bug). It must
        # now resolve to "connected".
        assert _status_for_heartbeat(None) == "connected"

    def test_explicit_connected_stays_connected(self):
        assert _status_for_heartbeat("connected") == "connected"

    def test_running_is_preserved(self):
        assert _status_for_heartbeat("running") == "running"

    def test_unknown_status_collapses_to_connected(self):
        # Anything that isn't "running" is still a live agent.
        assert _status_for_heartbeat("idle") == "connected"


class TestOwnsAgentConnection:
    def test_true_when_registered_ws_is_this_ws(self):
        ws = object()
        bm._agent_ws_connections[999] = ws
        try:
            assert _owns_agent_connection(999, ws) is True
        finally:
            bm._agent_ws_connections.pop(999, None)

    def test_false_when_a_newer_ws_replaced_it(self):
        old_ws, new_ws = object(), object()
        bm._agent_ws_connections[999] = new_ws  # restart already re-registered
        try:
            # The old handler's teardown must see it no longer owns the slot.
            assert _owns_agent_connection(999, old_ws) is False
        finally:
            bm._agent_ws_connections.pop(999, None)

    def test_false_when_no_connection_registered(self):
        bm._agent_ws_connections.pop(999, None)
        assert _owns_agent_connection(999, object()) is False


class TestCheckAgentConnection:
    def test_check_heals_disconnected_when_ws_active(self):
        from unittest.mock import MagicMock, patch
        from models.enums import BenchmarkAgentStatus
        from routes.benchmarks import check_benchmark_agent_connection

        mock_agent = MagicMock()
        mock_agent.id = 42
        mock_agent.name = "test-agent"
        mock_agent.status = BenchmarkAgentStatus.DISCONNECTED
        mock_agent.ip_address = "10.0.0.1"
        mock_agent.host_ip = None
        mock_agent.ssh_port = 22
        mock_agent.last_heartbeat = None

        mock_svc = MagicMock()
        mock_svc.get_agent.return_value = mock_agent
        mock_svc.update_agent_status.return_value = mock_agent

        mock_db = MagicMock()
        mock_user = MagicMock()

        bm._agent_ws_connections[42] = object()
        try:
            with patch("routes.benchmarks.BenchmarkService", return_value=mock_svc):
                res = check_benchmark_agent_connection(42, user=mock_user, db=mock_db)
                assert res.ws_connected is True
                mock_svc.update_agent_status.assert_called_once_with(42, BenchmarkAgentStatus.CONNECTED)
        finally:
            bm._agent_ws_connections.pop(42, None)

    def test_check_marks_disconnected_when_ws_inactive(self):
        from unittest.mock import MagicMock, patch
        from models.enums import BenchmarkAgentStatus
        from routes.benchmarks import check_benchmark_agent_connection

        mock_agent = MagicMock()
        mock_agent.id = 42
        mock_agent.name = "test-agent"
        mock_agent.status = BenchmarkAgentStatus.CONNECTED
        mock_agent.ip_address = "127.0.0.1"
        mock_agent.host_ip = None
        mock_agent.ssh_port = 22
        mock_agent.last_heartbeat = None

        mock_svc = MagicMock()
        mock_svc.get_agent.return_value = mock_agent
        mock_svc.update_agent_status.return_value = mock_agent

        mock_db = MagicMock()
        mock_user = MagicMock()

        bm._agent_ws_connections.pop(42, None)
        with patch("routes.benchmarks.BenchmarkService", return_value=mock_svc):
            with patch("socket.socket") as mock_sock_cls:
                mock_sock = MagicMock()
                mock_sock.connect_ex.return_value = 111  # ECONNREFUSED -> host IP responds
                mock_sock_cls.return_value = mock_sock
                res = check_benchmark_agent_connection(42, user=mock_user, db=mock_db)
                assert res.ws_connected is False
                assert res.host_reachable is True
                mock_svc.update_agent_status.assert_called_once_with(42, BenchmarkAgentStatus.DISCONNECTED)


class TestConnectAgentConnection:
    """Tests for POST /api/benchmarks/agents/{agent_id}/connect."""

    def test_connect_already_connected(self):
        from unittest.mock import MagicMock, patch
        from models.enums import BenchmarkAgentStatus
        from routes.benchmarks import connect_benchmark_agent

        mock_agent = MagicMock()
        mock_agent.id = 42
        mock_agent.name = "test-agent"
        mock_agent.status = BenchmarkAgentStatus.CONNECTED

        mock_svc = MagicMock()
        mock_svc.get_agent.return_value = mock_agent

        mock_db = MagicMock()
        mock_user = MagicMock()

        bm._agent_ws_connections[42] = MagicMock()
        try:
            with patch("routes.benchmarks.BenchmarkService", return_value=mock_svc):
                res = connect_benchmark_agent(42, user=mock_user, db=mock_db)
                assert res.success is True
                assert res.status == BenchmarkAgentStatus.CONNECTED
                assert res.method == "websocket"
        finally:
            bm._agent_ws_connections.pop(42, None)

    def test_connect_via_ssh_success(self):
        from unittest.mock import MagicMock, patch
        from models.enums import BenchmarkAgentStatus
        from routes.benchmarks import connect_benchmark_agent

        mock_agent = MagicMock()
        mock_agent.id = 42
        mock_agent.name = "remote-agent"
        mock_agent.tags = {}
        mock_agent.status = BenchmarkAgentStatus.DISCONNECTED
        mock_agent.ssh_credential_id = 5
        mock_agent.host_ip = "192.168.1.50"
        mock_agent.ssh_port = 22
        mock_agent.jumphost_chain = None

        mock_cred = MagicMock()
        mock_cred.id = 5
        mock_cred.host = "192.168.1.50"
        mock_cred.port = 22

        mock_svc = MagicMock()
        mock_svc.get_agent.return_value = mock_agent

        mock_db = MagicMock()
        mock_db.query.return_value.filter_by.return_value.first.return_value = mock_cred
        mock_user = MagicMock()

        mock_ssh = MagicMock()
        mock_ssh.execute.return_value = MagicMock(exit_code=0, stdout="ok", stderr="")
        mock_ssh_ctx = MagicMock()
        mock_ssh_ctx.__enter__.return_value = mock_ssh
        mock_ssh_ctx.__exit__.return_value = None

        bm._agent_ws_connections.pop(42, None)
        with patch("routes.benchmarks.BenchmarkService", return_value=mock_svc):
            with patch(
                "services.bare_metal.ssh_provision.build_ssh_session_from_credential", return_value=mock_ssh_ctx
            ):
                res = connect_benchmark_agent(42, user=mock_user, db=mock_db)
                assert res.success is True
                assert res.method == "ssh"
                mock_ssh.execute.assert_called()

    def test_connect_via_ssh_failure(self):
        from unittest.mock import MagicMock, patch
        from models.enums import BenchmarkAgentStatus
        from routes.benchmarks import connect_benchmark_agent

        mock_agent = MagicMock()
        mock_agent.id = 42
        mock_agent.name = "remote-agent"
        mock_agent.tags = {}
        mock_agent.status = BenchmarkAgentStatus.DISCONNECTED
        mock_agent.ssh_credential_id = 5
        mock_agent.host_ip = "10.0.10.200"
        mock_agent.ssh_port = 22
        mock_agent.jumphost_chain = None

        mock_cred = MagicMock()
        mock_cred.id = 5
        mock_cred.host = "10.0.10.200"
        mock_cred.port = 22

        mock_svc = MagicMock()
        mock_svc.get_agent.return_value = mock_agent

        mock_db = MagicMock()
        mock_db.query.return_value.filter_by.return_value.first.return_value = mock_cred
        mock_user = MagicMock()

        bm._agent_ws_connections.pop(42, None)
        with patch("routes.benchmarks.BenchmarkService", return_value=mock_svc):
            with patch(
                "services.bare_metal.ssh_provision.build_ssh_session_from_credential",
                side_effect=Exception("Connection refused"),
            ):
                res = connect_benchmark_agent(42, user=mock_user, db=mock_db)
                assert res.success is False
                assert res.method == "ssh"
                assert "Connection refused" in res.error

    def test_connect_unmanaged_without_credentials(self):
        from unittest.mock import MagicMock, patch
        from models.enums import BenchmarkAgentStatus
        from routes.benchmarks import connect_benchmark_agent

        mock_agent = MagicMock()
        mock_agent.id = 42
        mock_agent.name = "unmanaged-agent"
        mock_agent.tags = {}
        mock_agent.status = BenchmarkAgentStatus.DISCONNECTED
        mock_agent.ssh_credential_id = None
        mock_agent.ip_address = None
        mock_agent.hostname = None
        mock_agent.host_ip = None

        mock_svc = MagicMock()
        mock_svc.get_agent.return_value = mock_agent

        mock_db = MagicMock()
        mock_db.query.return_value.filter_by.return_value.first.return_value = None
        mock_user = MagicMock()

        bm._agent_ws_connections.pop(42, None)
        with patch("routes.benchmarks.BenchmarkService", return_value=mock_svc):
            res = connect_benchmark_agent(42, user=mock_user, db=mock_db)
            assert res.success is False
            assert res.method == "none"
            assert res.status == "unsupported"

    def test_connect_ec2_instance_id_handled_gracefully(self):
        from unittest.mock import MagicMock, patch
        from models.enums import BenchmarkAgentStatus
        from routes.benchmarks import connect_benchmark_agent

        mock_agent = MagicMock()
        mock_agent.id = 7
        mock_agent.name = "awsbnkctl-jumphost-i-0cc32d5c5517d97ef"
        mock_agent.tags = {"managed_by": "awsbnkctl"}
        mock_agent.status = BenchmarkAgentStatus.DISCONNECTED
        mock_agent.ssh_credential_id = 2
        mock_agent.host_ip = None
        mock_agent.ip_address = "127.0.0.1"
        mock_agent.hostname = "i-0cc32d5c5517d97ef"

        mock_cred = MagicMock()
        mock_cred.id = 2
        mock_cred.host = "i-0cc32d5c5517d97ef"

        mock_svc = MagicMock()
        mock_svc.get_agent.return_value = mock_agent

        mock_db = MagicMock()
        mock_db.query.return_value.filter_by.return_value.first.return_value = mock_cred
        mock_user = MagicMock()

        bm._agent_ws_connections.pop(7, None)
        with patch("routes.benchmarks.BenchmarkService", return_value=mock_svc):
            res = connect_benchmark_agent(7, user=mock_user, db=mock_db)
            assert res.success is False
            assert res.method == "awsbnkctl"
            assert "awsbnkctl benchmark daemon" in res.message
