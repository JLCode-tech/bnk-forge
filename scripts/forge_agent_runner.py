#!/usr/bin/env python3
"""
Forge Benchmark Agent Runner & Multi-Cloud Daemon Supervisor.

Maintains persistent 24/7 connections for Forge benchmark agents across
environments (local built-in, AWS, Azure, GCP, and on-prem):
1. Discovers configured agents from Forge REST API.
2. Mints / refreshes JWT authentication tokens.
3. Spawns and supervises daemon child processes (awsbnkctl, azrbnkctl, gkebnkctl, forge_agent.py).
4. Pipes and tags logs from each daemon to supervisor stdout.
5. Automatically reconnects when tokens expire, network drops, or processes exit.
"""

import logging
import os
import re
import shutil
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Dict, Optional

try:
    import requests

    requests.packages.urllib3.disable_warnings()
except ImportError:
    print(
        "ERROR: 'requests' package required. Install: pip install requests",
        file=sys.stderr,
    )
    sys.exit(1)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [agent-runner] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("agent-runner")

# Configuration
FORGE_URL = os.environ.get("FORGE_URL", "http://localhost:8000").rstrip("/")
BOOTSTRAP_TOKEN_FILE = os.environ.get(
    "AGENT_TOKEN_FILE", "/run/forge/builtin_agent.token"
)
MANUAL_BOOTSTRAP_TOKEN = os.environ.get("AGENT_TOKEN", "")
SYNC_INTERVAL = int(os.environ.get("SYNC_INTERVAL", "10"))
LOCAL_AGENT_ENABLED = os.environ.get("LOCAL_AGENT_ENABLED", "false").lower() in (
    "1",
    "true",
    "yes",
)
LOCAL_AGENT_NAME = os.environ.get("AGENT_NAME", "forge-local")

AWSBNKCTL_PATH = os.environ.get("AWSBNKCTL_PATH", "/usr/local/bin/awsbnkctl")
AZRBNKCTL_PATH = os.environ.get("AZRBNKCTL_PATH", "/usr/local/bin/azrbnkctl")
GKEBNKCTL_PATH = os.environ.get("GKEBNKCTL_PATH", "/usr/local/bin/gkebnkctl")

# Search paths for forge_agent.py
REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPT_CANDIDATES = [
    REPO_ROOT / "scripts" / "forge_agent.py",
    Path("/app/scripts/forge_agent.py"),
    Path("/app/forge_agent.py"),
]


def find_forge_agent_script() -> Optional[str]:
    for candidate in SCRIPT_CANDIDATES:
        if candidate.exists():
            return str(candidate)
    return None


def get_bootstrap_token() -> str:
    """Read the bootstrap token from env or token volume."""
    if MANUAL_BOOTSTRAP_TOKEN:
        return MANUAL_BOOTSTRAP_TOKEN.strip()
    p = Path(BOOTSTRAP_TOKEN_FILE)
    if p.exists():
        try:
            return p.read_text().strip()
        except Exception as e:
            log.warning("Failed reading token file %s: %s", BOOTSTRAP_TOKEN_FILE, e)
    return ""


def stream_process_output(proc: subprocess.Popen, prefix: str):
    """Read child stdout lines and emit to log."""
    try:
        if proc.stdout:
            for line in iter(proc.stdout.readline, ""):
                if not line:
                    break
                clean = line.rstrip()
                if clean:
                    log.info("[%s] %s", prefix, clean)
    except Exception:
        pass


class ManagedAgent:
    def __init__(
        self,
        agent_id: int,
        agent_name: str,
        agent_type: str,
        ip_address: Optional[str] = None,
        raw_data: Optional[dict] = None,
    ):
        self.agent_id = agent_id
        self.agent_name = agent_name
        self.agent_type = agent_type
        self.ip_address = ip_address
        self.raw_data = raw_data or {}
        self.process: Optional[subprocess.Popen] = None
        self.token: str = ""
        self.token_minted_at: float = 0
        self.cloud_credentials: Optional[dict] = None
        self.restart_count = 0
        self.last_start: float = 0
        self.backoff: float = 2.0
        self.log_thread: Optional[threading.Thread] = None

    def is_alive(self) -> bool:
        if self.process is None:
            return False
        return self.process.poll() is None

    def stop(self):
        if self.process and self.is_alive():
            pid = self.process.pid
            log.info(
                "Stopping agent daemon [%s (id=%d)] PID=%d",
                self.agent_name,
                self.agent_id,
                pid,
            )
            try:
                # Terminate entire process group cleanly
                try:
                    pgid = os.getpgid(pid)
                    os.killpg(pgid, signal.SIGTERM)
                except (ProcessLookupError, PermissionError, AttributeError):
                    self.process.terminate()
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                log.warning(
                    "Agent daemon [%s] did not terminate in 5s; killing",
                    self.agent_name,
                )
                try:
                    pgid = os.getpgid(pid)
                    os.killpg(pgid, signal.SIGKILL)
                except (ProcessLookupError, PermissionError, AttributeError):
                    self.process.kill()
            except Exception as e:
                log.warning("Error stopping agent [%s]: %s", self.agent_name, e)
        self.process = None


class AgentRunnerSupervisor:
    def __init__(self):
        self.running = True
        self.managed: Dict[int, ManagedAgent] = {}
        self.session = requests.Session()
        self.session.verify = False

        signal.signal(signal.SIGINT, self._handle_signal)
        signal.signal(signal.SIGTERM, self._handle_signal)

    def _handle_signal(self, signum, frame):
        log.info("Received signal %d; shutting down supervised agents...", signum)
        self.running = False
        self.stop_all()
        sys.exit(0)

    def stop_all(self):
        for agent in self.managed.values():
            agent.stop()
        self.managed.clear()

    def mint_token(
        self,
        agent_id: int,
        bootstrap_token: str,
        managed_agent: Optional[ManagedAgent] = None,
    ) -> Optional[str]:
        """Mint a fresh JWT token for a specific agent ID and capture cloud credentials."""
        url = f"{FORGE_URL}/api/benchmarks/agents/{agent_id}/token"
        headers = {}
        if bootstrap_token:
            headers["Authorization"] = f"Bearer {bootstrap_token}"
        try:
            resp = self.session.post(url, headers=headers, timeout=10)
            if resp.status_code == 200:
                data = resp.json()
                if managed_agent and data.get("cloud_credentials"):
                    managed_agent.cloud_credentials = data["cloud_credentials"]
                    log.info(
                        "Injected %d cloud credential keys for agent %s",
                        len(managed_agent.cloud_credentials),
                        managed_agent.agent_name,
                    )
                token = data.get("token")
                if managed_agent and token:
                    managed_agent.token = token
                    managed_agent.token_minted_at = time.time()
                return token
            log.warning(
                "Token minting for agent %d failed (%d): %s",
                agent_id,
                resp.status_code,
                resp.text[:200],
            )
        except Exception as e:
            log.warning("Token mint request failed for agent %d: %s", agent_id, e)
        return None

    def fetch_agents(self, bootstrap_token: str) -> list:
        """Fetch list of agents configured in Forge."""
        url = f"{FORGE_URL}/api/benchmarks/agents"
        headers = {}
        if bootstrap_token:
            headers["Authorization"] = f"Bearer {bootstrap_token}"
        try:
            resp = self.session.get(url, headers=headers, timeout=10)
            if resp.status_code == 200:
                return resp.json()
            log.warning(
                "Failed fetching agents from Forge (%d): %s",
                resp.status_code,
                resp.text[:200],
            )
        except Exception as e:
            log.warning("Could not reach Forge backend at %s: %s", FORGE_URL, e)
        return None

    def classify_agent(self, agent_dict: dict) -> str:
        name = (agent_dict.get("name") or "").lower()
        hostname = (agent_dict.get("hostname") or "").lower()
        tags = agent_dict.get("tags") or {}
        if isinstance(tags, list):
            tags_dict = {str(t).lower(): True for t in tags}
        elif isinstance(tags, dict):
            tags_dict = {k.lower(): v for k, v in tags.items()}
        else:
            tags_dict = {}

        infra = (agent_dict.get("infra") or tags_dict.get("infra") or "").lower()
        project_name = (agent_dict.get("project_name") or "").lower()

        if (
            name == LOCAL_AGENT_NAME.lower()
            or tags_dict.get("builtin") is True
            or tags_dict.get("_forge_builtin") is True
        ):
            return "builtin"
        if (
            infra in ("aws", "eks")
            or "aws" in name
            or "aws" in project_name
            or hostname.startswith("i-")
            or "cloud:aws" in tags_dict
            or tags_dict.get("cloud") == "aws"
        ):
            return "aws"
        if (
            infra in ("azure", "azr", "aks")
            or "azr" in name
            or "azure" in name
            or "azure" in project_name
            or "cloud:azure" in tags_dict
            or tags_dict.get("cloud") == "azure"
        ):
            return "azure"
        if (
            infra in ("gke", "gcp")
            or "gke" in name
            or "gcp" in name
            or "gcp" in project_name
            or "cloud:gcp" in tags_dict
            or "cloud:gke" in tags_dict
            or tags_dict.get("cloud") in ("gcp", "gke")
        ):
            return "gke"
        return "generic"

    def spawn_daemon(self, managed_agent: ManagedAgent, bootstrap_token: str):
        agent_id = managed_agent.agent_id
        agent_name = managed_agent.agent_name
        agent_type = managed_agent.agent_type

        # Mint fresh token for cloud agents
        token = ""
        if agent_type != "builtin":
            token = (
                self.mint_token(agent_id, bootstrap_token, managed_agent)
                or bootstrap_token
            )

        cmd = []
        if agent_type == "builtin":
            script = find_forge_agent_script()
            if not script:
                log.error("Cannot spawn built-in agent: forge_agent.py not found")
                return
            cmd = [
                sys.executable,
                script,
                "--forge-url",
                FORGE_URL,
                "--agent-name",
                agent_name,
            ]
            if os.path.exists(BOOTSTRAP_TOKEN_FILE):
                cmd.extend(["--token-file", BOOTSTRAP_TOKEN_FILE])
            elif bootstrap_token:
                cmd.extend(["--token", bootstrap_token])
            advertise_ip = os.environ.get("FORGE_AGENT_ADVERTISE_IP")
            if advertise_ip:
                cmd.extend(["--advertise-ip", advertise_ip])

        elif agent_type == "aws":
            aws_bin = (
                shutil.which(AWSBNKCTL_PATH)
                or shutil.which("awsbnkctl")
                or AWSBNKCTL_PATH
            )
            if not os.path.isfile(aws_bin) or not os.access(aws_bin, os.X_OK):
                log.warning(
                    "awsbnkctl binary not executable at %s; skipping cloud agent %s",
                    aws_bin,
                    agent_name,
                )
                return
            cmd = [
                aws_bin,
                "benchmark",
                "daemon",
                "--forge-rest-url",
                FORGE_URL,
                "--agent-name",
                agent_name,
                "--forge-agent-token",
                token,
            ]
            source_ip = managed_agent.ip_address or managed_agent.raw_data.get(
                "host_ip"
            )
            if source_ip and source_ip not in ("127.0.0.1", "localhost", "::1"):
                cmd.extend(["--source-ip", source_ip])

            target_ip = source_ip
            target_name = agent_name.lower()
            target_host = (managed_agent.raw_data.get("hostname") or "").lower()
            target_proj = (managed_agent.raw_data.get("project_name") or "").lower()

            matched_ws = None
            matched_instance_id = None
            matched_region = None
            matched_source_ip = None

            bases = [
                os.path.expanduser("~/.awsbnkctl"),
                "/home/forgeagent/.awsbnkctl",
                "/app/.awsbnkctl",
            ]
            for base in bases:
                if not os.path.isdir(base):
                    continue
                workspaces = sorted(os.listdir(base))
                # 1. Match by instance ID in hostname or name
                for ws in workspaces:
                    st_path = os.path.join(base, ws, "state.env")
                    if not os.path.isfile(st_path):
                        continue
                    try:
                        with open(st_path) as f:
                            c = f.read()
                        vars_ = dict(
                            line.split("=", 1)
                            for line in c.splitlines()
                            if "=" in line and not line.strip().startswith("#")
                        )
                        inst = vars_.get("JUMPHOST_INSTANCE_ID", "").strip()
                        if inst and (inst == target_host or inst in target_name):
                            matched_ws = ws
                            matched_instance_id = inst
                            matched_region = (
                                vars_.get("AWS_REGION")
                                or vars_.get("REGION", "ap-southeast-2").strip()
                            )
                            matched_source_ip = vars_.get(
                                "JUMPHOST_BNK_EXT_ENI_IP", ""
                            ).strip()
                            break
                    except Exception:
                        pass
                if matched_ws:
                    break

                # 2. Match by cluster or project name
                for ws in workspaces:
                    st_path = os.path.join(base, ws, "state.env")
                    if not os.path.isfile(st_path):
                        continue
                    try:
                        with open(st_path) as f:
                            c = f.read()
                        vars_ = dict(
                            line.split("=", 1)
                            for line in c.splitlines()
                            if "=" in line and not line.strip().startswith("#")
                        )
                        cluster = vars_.get("CLUSTER_NAME", "").strip()
                        if (
                            target_proj
                            and cluster
                            and (
                                target_proj == cluster
                                or target_proj.replace("aws-", "bnk-") in cluster
                                or ws in target_proj
                            )
                        ):
                            matched_ws = ws
                            matched_instance_id = vars_.get(
                                "JUMPHOST_INSTANCE_ID", ""
                            ).strip()
                            matched_region = (
                                vars_.get("AWS_REGION")
                                or vars_.get("REGION", "ap-southeast-2").strip()
                            )
                            matched_source_ip = vars_.get(
                                "JUMPHOST_BNK_EXT_ENI_IP", ""
                            ).strip()
                            break
                    except Exception:
                        pass
                if matched_ws:
                    break

                # 3. Match by target IP
                for ws in workspaces:
                    st_path = os.path.join(base, ws, "state.env")
                    if not os.path.isfile(st_path):
                        continue
                    try:
                        with open(st_path) as f:
                            c = f.read()
                        vars_ = dict(
                            line.split("=", 1)
                            for line in c.splitlines()
                            if "=" in line and not line.strip().startswith("#")
                        )
                        ext_ip = vars_.get("JUMPHOST_BNK_EXT_ENI_IP", "").strip()
                        if target_ip and ext_ip and target_ip == ext_ip:
                            matched_ws = ws
                            matched_instance_id = vars_.get(
                                "JUMPHOST_INSTANCE_ID", ""
                            ).strip()
                            matched_region = (
                                vars_.get("AWS_REGION")
                                or vars_.get("REGION", "ap-southeast-2").strip()
                            )
                            matched_source_ip = ext_ip
                            break
                    except Exception:
                        pass
                if matched_ws:
                    break

            if matched_ws:
                cmd.extend(["--workspace", matched_ws])
            if matched_instance_id:
                cmd.extend(["--instance-id", matched_instance_id])
            if matched_region:
                cmd.extend(["--region", matched_region])
            if matched_source_ip and "--source-ip" not in cmd:
                cmd.extend(["--source-ip", matched_source_ip])
            cmd.append("--synthetic")

        elif agent_type == "azure":
            azr_bin = (
                shutil.which(AZRBNKCTL_PATH)
                or shutil.which("azrbnkctl")
                or AZRBNKCTL_PATH
            )
            if not os.path.isfile(azr_bin) or not os.access(azr_bin, os.X_OK):
                log.warning(
                    "azrbnkctl binary not executable at %s; skipping agent %s",
                    azr_bin,
                    agent_name,
                )
                return
            cmd = [
                azr_bin,
                "benchmark",
                "daemon",
                "--forge-rest-url",
                FORGE_URL,
                "--agent-name",
                agent_name,
                "--forge-agent-token",
                token,
                "--synthetic",
            ]

        elif agent_type == "gke":
            gke_bin = (
                shutil.which(GKEBNKCTL_PATH)
                or shutil.which("gkebnkctl")
                or GKEBNKCTL_PATH
            )
            if not os.path.isfile(gke_bin) or not os.access(gke_bin, os.X_OK):
                log.warning(
                    "gkebnkctl binary not executable at %s; skipping agent %s",
                    gke_bin,
                    agent_name,
                )
                return
            cmd = [
                gke_bin,
                "benchmark",
                "daemon",
                "--forge-rest-url",
                FORGE_URL,
                "--agent-name",
                agent_name,
                "--forge-agent-token",
                token,
                "--synthetic",
            ]
        else:
            log.info(
                "Agent [%s (id=%d)] is an unmanaged generic host. Expecting external connection.",
                agent_name,
                agent_id,
            )
            return

        try:
            log.info(
                "Spawning agent daemon [%s (id=%d)] type=%s: %s",
                agent_name,
                agent_id,
                agent_type,
                " ".join(cmd[:4]),
            )
            proc_env = os.environ.copy()
            if managed_agent.cloud_credentials:
                proc_env.update(managed_agent.cloud_credentials)

            proc = subprocess.Popen(
                cmd,
                env=proc_env,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
                start_new_session=True,
            )
            managed_agent.process = proc
            if token:
                managed_agent.token = token
            if not managed_agent.token_minted_at:
                managed_agent.token_minted_at = time.time()
            managed_agent.last_start = time.time()
            managed_agent.restart_count += 1
            managed_agent.backoff = min(managed_agent.backoff * 1.5, 30.0)

            # Start background thread to capture logs
            t = threading.Thread(
                target=stream_process_output,
                args=(proc, agent_name),
                daemon=True,
            )
            t.start()
            managed_agent.log_thread = t

        except Exception as e:
            log.error("Failed to spawn agent daemon [%s]: %s", agent_name, e)

    def run(self):
        log.info("Forge Benchmark Agent Supervisor starting...")
        log.info("Forge URL: %s | Sync interval: %ds", FORGE_URL, SYNC_INTERVAL)

        # Allow backend a few seconds on boot
        time.sleep(2)

        while self.running:
            try:
                bootstrap_token = get_bootstrap_token()
                agents_list = self.fetch_agents(bootstrap_token)
                if agents_list is None:
                    time.sleep(SYNC_INTERVAL)
                    continue

                current_agent_ids = set()
                for agent_dict in agents_list:
                    aid = agent_dict.get("id")
                    aname = agent_dict.get("name")
                    if not aid or not aname:
                        continue
                    current_agent_ids.add(aid)

                    atype = self.classify_agent(agent_dict)
                    if atype == "builtin" and not LOCAL_AGENT_ENABLED:
                        continue

                    if aid not in self.managed:
                        self.managed[aid] = ManagedAgent(
                            aid,
                            aname,
                            atype,
                            ip_address=agent_dict.get("ip_address")
                            or agent_dict.get("host_ip"),
                            raw_data=agent_dict,
                        )
                    else:
                        if (
                            self.managed[aid].agent_name != aname
                            or self.managed[aid].agent_type != atype
                        ):
                            log.info(
                                "Agent ID %d metadata changed (%s -> %s); restarting daemon",
                                aid,
                                self.managed[aid].agent_name,
                                aname,
                            )
                            self.managed[aid].stop()
                            self.managed[aid].agent_name = aname
                            self.managed[aid].agent_type = atype
                            self.managed[aid].backoff = 1
                            self.managed[aid].last_start = 0
                        self.managed[aid].ip_address = agent_dict.get(
                            "ip_address"
                        ) or agent_dict.get("host_ip")
                        self.managed[aid].raw_data = agent_dict

                    managed_agent = self.managed[aid]

                    # Proactive token rotation before 24h expiration (rotate at >= 20 hours / 72,000s)
                    if (
                        managed_agent.is_alive()
                        and managed_agent.token_minted_at > 0
                        and (time.time() - managed_agent.token_minted_at >= 72000)
                    ):
                        log.info(
                            "Token for agent [%s (id=%d)] is older than 20 hours; rotating token and restarting daemon",
                            aname,
                            aid,
                        )
                        managed_agent.stop()
                        managed_agent.token = ""
                        managed_agent.token_minted_at = 0
                        new_tok = self.mint_token(aid, bootstrap_token, managed_agent)
                        if managed_agent.agent_type == "builtin" and new_tok:
                            try:
                                with open(BOOTSTRAP_TOKEN_FILE, "w") as f:
                                    f.write(new_tok.strip() + "\n")
                            except Exception as e:
                                log.warning(
                                    "Could not write updated token to %s: %s",
                                    BOOTSTRAP_TOKEN_FILE,
                                    e,
                                )
                        managed_agent.backoff = 1.0
                        managed_agent.last_start = 0

                    # Check if process died
                    if managed_agent.process is not None:
                        exit_code = managed_agent.process.poll()
                        if exit_code is not None:
                            log.warning(
                                "Agent daemon [%s (id=%d)] exited with code %d",
                                aname,
                                aid,
                                exit_code,
                            )
                            managed_agent.process = None
                            if exit_code == 41:
                                log.info(
                                    "Agent [%s (id=%d)] exited with code 41 (token expired/invalid); refreshing token",
                                    aname,
                                    aid,
                                )
                                managed_agent.token = ""
                                managed_agent.token_minted_at = 0
                                new_tok = self.mint_token(
                                    aid, bootstrap_token, managed_agent
                                )
                                if managed_agent.agent_type == "builtin" and new_tok:
                                    try:
                                        with open(BOOTSTRAP_TOKEN_FILE, "w") as f:
                                            f.write(new_tok.strip() + "\n")
                                    except Exception as e:
                                        log.warning(
                                            "Could not write updated token to %s: %s",
                                            BOOTSTRAP_TOKEN_FILE,
                                            e,
                                        )
                                managed_agent.backoff = 1.0
                                managed_agent.last_start = 0

                    # If not running, spawn it
                    if not managed_agent.is_alive():
                        now = time.time()
                        if now - managed_agent.last_start >= managed_agent.backoff:
                            self.spawn_daemon(managed_agent, bootstrap_token)

                # Clean up removed agents
                removed_ids = set(self.managed.keys()) - current_agent_ids
                for rid in removed_ids:
                    log.info(
                        "Agent ID %d was removed from Forge; stopping supervisor daemon",
                        rid,
                    )
                    self.managed[rid].stop()
                    del self.managed[rid]

            except Exception as e:
                log.exception("Supervisor error in reconciliation loop: %s", e)

            # Sleep sync interval
            for _ in range(SYNC_INTERVAL):
                if not self.running:
                    break
                time.sleep(1)

        self.stop_all()


if __name__ == "__main__":
    supervisor = AgentRunnerSupervisor()
    supervisor.run()
