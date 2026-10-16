"""
Agent Host Candidates Service — aggregate project-scoped host/jumphost picker data.

Gathers candidates from four sources so the UI can pre-fill the
RegisterRemoteHostDialog rather than requiring manual IP entry.

Sources (in display order):
  aws_jumphost    — ProjectModule outputs containing jumphost_ssh_command
  bare_metal      — BareMetalHost rows for the project
  cluster_bastion — KubernetesCluster rows that have ssh_credential_id set
  ssh_credential  — Global SSHCredential rows (project-independent)
"""

from __future__ import annotations

import logging
import os
import re
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from sqlalchemy.orm import Session

from core.errors import BadRequestError, NotFoundError
from models.bare_metal import BareMetalHost
from models.kubernetes import KubernetesCluster
from models.project import Project, ProjectModule
from models.ssh_credential import SSHCredential
from schemas.benchmarks import AgentHostCandidate
from services.infrastructure_access_service import (
    INFRA_JUMPHOST_COMMAND_FIELD,
    INFRA_PRIVATE_KEY_AVAILABLE_FIELD,
    INFRA_PRIVATE_KEY_PATH_FIELD,
    get_durable_infra_private_key_path,
)

logger = logging.getLogger(__name__)

# Matches ssh -i key.pem user@host or ssh -i "key.pem" user@host
_SSH_USER_HOST_RE = re.compile(r"(\S+)@(\S+)\s*$")


def _parse_bastion_from_ssh_command(command: str | None) -> tuple[str | None, str | None]:
    """Extract (username, host_ip) from a jumphost_ssh_command string.

    Handles:
      ssh -i /path/to/key.pem ec2-user@1.2.3.4
      ssh -i "/path/to/key.pem" ec2-user@10.0.0.5 -p 22
    Returns (username, host_ip) or (None, None) if unparseable.
    """
    if not command:
        return None, None
    m = _SSH_USER_HOST_RE.search(command)
    if not m:
        return None, None
    username, host = m.group(1), m.group(2)
    # Strip trailing flags like -p 22 if they leaked into the host position
    host = host.split()[0] if " " in host else host
    return username, host


class AgentHostCandidatesService:
    def __init__(self, db: Session):
        self.db = db

    # ------------------------------------------------------------------ #
    # Public API
    # ------------------------------------------------------------------ #

    def list_candidates(self, project_id: int) -> list[AgentHostCandidate]:
        """Aggregate all candidate sources for a project."""
        candidates: list[AgentHostCandidate] = []
        candidates.extend(self._cloud_workspace_candidates(project_id))
        candidates.extend(self._aws_jumphost_candidates(project_id))
        candidates.extend(self._bare_metal_candidates(project_id))
        candidates.extend(self._cluster_bastion_candidates(project_id))
        candidates.extend(self._ssh_credential_candidates(project_id))
        return candidates

    def _cloud_workspace_candidates(self, project_id: int) -> list[AgentHostCandidate]:
        """Discover candidate jumphosts and agent nodes from cloud workspace state files."""
        candidates: list[AgentHostCandidate] = []
        project = self.db.query(Project).filter(Project.id == project_id).first()
        if not project:
            return candidates

        clusters = self.db.query(KubernetesCluster).filter(KubernetesCluster.project_id == project_id).all()
        cluster_names = [c.name.lower() for c in clusters]
        project_name = project.name.lower()

        search_bases = [
            "/app/.awsbnkctl",
            "/home/forgeagent/.awsbnkctl",
            "/root/.awsbnkctl",
            os.path.expanduser("~/.awsbnkctl"),
            "/Users/j.lucia/Code/github/awsbnkctl/.awsbnkctl",
            "/app/.azrbnkctl",
            "/home/forgeagent/.azrbnkctl",
            "/root/.azrbnkctl",
            os.path.expanduser("~/.azrbnkctl"),
            "/Users/j.lucia/Code/github/azrbnkctl/.azrbnkctl",
            "/app/.gkebnkctl",
            "/home/forgeagent/.gkebnkctl",
            "/root/.gkebnkctl",
            os.path.expanduser("~/.gkebnkctl"),
            "/Users/j.lucia/Code/github/gkebnkctl/.gkebnkctl",
        ]

        all_creds = self.db.query(SSHCredential).all()
        default_cred_id = all_creds[0].id if all_creds else None

        for base in search_bases:
            if not os.path.isdir(base):
                continue
            try:
                workspaces = os.listdir(base)
            except Exception:
                continue

            for ws in workspaces:
                ws_lower = ws.lower()
                matched = (
                    ws_lower == project_name
                    or ws_lower in project_name
                    or project_name in ws_lower
                    or any(ws_lower == cn or ws_lower in cn or cn in ws_lower for cn in cluster_names)
                )
                if not matched:
                    continue

                st_path = os.path.join(base, ws, "state.env")
                if not os.path.isfile(st_path):
                    continue

                st: dict[str, str] = {}
                try:
                    with open(st_path) as f:
                        for line in f:
                            line = line.strip()
                            if line and not line.startswith("#") and "=" in line:
                                k, v = line.split("=", 1)
                                st[k.strip()] = v.strip().strip('"').strip("'")
                except Exception:
                    continue

                ext_ip = st.get("JUMPHOST_BNK_EXT_ENI_IP")
                mgmt_ip = st.get("JUMPHOST_MGMT_ENI_IP")
                instance_id = st.get("JUMPHOST_INSTANCE_ID")

                cred_id = default_cred_id
                if instance_id:
                    for c in all_creds:
                        if (
                            instance_id in c.name
                            or instance_id in (c.host or "")
                            or instance_id in (c.description or "")
                        ):
                            cred_id = c.id
                            break

                if ext_ip:
                    candidates.append(
                        AgentHostCandidate(
                            label=f"AWS Jumphost (Ext ENI) — {ws} ({ext_ip})",
                            host_ip=ext_ip,
                            ssh_credential_id=cred_id,
                            ssh_port=22,
                            source="aws_jumphost",
                            source_ref=instance_id or ws,
                        )
                    )

                if mgmt_ip and mgmt_ip != ext_ip:
                    candidates.append(
                        AgentHostCandidate(
                            label=f"AWS Jumphost (MGMT ENI) — {ws} ({mgmt_ip})",
                            host_ip=mgmt_ip,
                            ssh_credential_id=cred_id,
                            ssh_port=22,
                            source="aws_jumphost",
                            source_ref=instance_id or ws,
                        )
                    )

                az_ip = st.get("AZURE_EXT_SELF_IP") or st.get("AZURE_INGRESS_PIP_ADDRESS")
                if az_ip:
                    candidates.append(
                        AgentHostCandidate(
                            label=f"Azure Host — {ws} ({az_ip})",
                            host_ip=az_ip,
                            ssh_credential_id=cred_id,
                            ssh_port=22,
                            source="cluster_bastion",
                            source_ref=st.get("AZURE_TMM_NODE_NAME") or ws,
                        )
                    )

                gke_ip = st.get("TMM_EXT_SELFIP")
                if gke_ip:
                    candidates.append(
                        AgentHostCandidate(
                            label=f"GKE Node — {ws} ({gke_ip})",
                            host_ip=gke_ip,
                            ssh_credential_id=cred_id,
                            ssh_port=22,
                            source="cluster_bastion",
                            source_ref=st.get("AGENT_NODE_NAME") or ws,
                        )
                    )

        return candidates

    def import_aws_jumphost(self, project_id: int, module_id: int) -> int:
        """Create (or return existing) SSHCredential from a module's AWS jumphost.

        Returns the ssh_credential_id.
        Raises BadRequestError if the PEM or jumphost command is unavailable.
        """
        module = (
            self.db.query(ProjectModule)
            .filter(ProjectModule.id == module_id, ProjectModule.project_id == project_id)
            .first()
        )
        if not module:
            raise NotFoundError("project_module", module_id)

        outputs: dict[str, Any] = module.outputs or {}
        jumphost_cmd = outputs.get(INFRA_JUMPHOST_COMMAND_FIELD)
        key_available = outputs.get(INFRA_PRIVATE_KEY_AVAILABLE_FIELD, False)
        key_path = outputs.get(INFRA_PRIVATE_KEY_PATH_FIELD)

        if not key_available or not jumphost_cmd:
            raise BadRequestError(
                "AWS jumphost key or command is not available for this module. "
                "Deploy the module first or run state recovery.",
                code="INFRA_KEY_UNAVAILABLE",
            )

        username, host_ip = _parse_bastion_from_ssh_command(jumphost_cmd)
        if not host_ip or not username:
            raise BadRequestError(
                f"Could not parse bastion host from jumphost_ssh_command: {jumphost_cmd!r}",
                code="JUMPHOST_PARSE_ERROR",
            )

        # Resolve durable PEM path
        pem_path = key_path or get_durable_infra_private_key_path(project_id, module_id)
        try:
            private_key = Path(pem_path).read_text()
        except Exception as exc:
            raise BadRequestError(
                f"Could not read infrastructure private key at {pem_path}: {exc}",
                code="PEM_READ_ERROR",
            )

        # Idempotent: look up by derived name
        cred_name = f"aws-jumphost-proj{project_id}-mod{module_id}"
        existing = self.db.query(SSHCredential).filter(SSHCredential.name == cred_name).first()
        if existing:
            return existing.id

        from routes.ssh_credentials import SSHCredentialCreate
        from services.ssh_credential_service import SSHCredentialService

        create_data = SSHCredentialCreate(
            name=cred_name,
            description=f"AWS jumphost for project {project_id}, module {module_id} — auto-imported",
            host=host_ip,
            port=22,
            username=username,
            auth_type="key",
            private_key=private_key,
        )
        result = SSHCredentialService(self.db).create_credential(create_data)
        return result["id"]

    # ------------------------------------------------------------------ #
    # Private: per-source collectors
    # ------------------------------------------------------------------ #

    def _aws_jumphost_candidates(self, project_id: int) -> list[AgentHostCandidate]:
        candidates: list[AgentHostCandidate] = []
        modules = self.db.query(ProjectModule).filter(ProjectModule.project_id == project_id).all()
        for module in modules:
            outputs: dict[str, Any] = module.outputs or {}
            if not outputs.get(INFRA_PRIVATE_KEY_AVAILABLE_FIELD):
                continue
            jumphost_cmd = outputs.get(INFRA_JUMPHOST_COMMAND_FIELD)
            if not jumphost_cmd:
                continue

            username, host_ip = _parse_bastion_from_ssh_command(jumphost_cmd)
            if not host_ip:
                continue

            key_path = outputs.get(INFRA_PRIVATE_KEY_PATH_FIELD)
            library_module = getattr(module, "library_module", None)
            module_label = (
                library_module.name if library_module and hasattr(library_module, "name") else f"module-{module.id}"
            )
            label = f"AWS jumphost — {module_label} ({host_ip})"

            # See if we already have an imported credential for this module
            cred_name = f"aws-jumphost-proj{project_id}-mod{module.id}"
            existing = self.db.query(SSHCredential).filter(SSHCredential.name == cred_name).first()
            ssh_credential_id = existing.id if existing else None
            needs_import = not existing

            candidates.append(
                AgentHostCandidate(
                    label=label,
                    host_ip=host_ip,
                    ssh_credential_id=ssh_credential_id,
                    ssh_port=22,
                    source="aws_jumphost",
                    source_ref=str(module.id),
                    needs_credential_import=needs_import,
                    infra_key_path=key_path,
                    module_id=module.id,
                )
            )
        return candidates

    def _bare_metal_candidates(self, project_id: int) -> list[AgentHostCandidate]:
        hosts = (
            self.db.query(BareMetalHost)
            .filter(BareMetalHost.project_id == project_id)
            .order_by(BareMetalHost.name)
            .all()
        )
        return [
            AgentHostCandidate(
                label=f"{h.name} ({h.host_ip})",
                host_ip=h.host_ip,
                ssh_credential_id=h.ssh_credential_id,
                ssh_port=h.ssh_port or 22,
                jumphost_chain=h.jumphost_chain,
                source="bare_metal",
                source_ref=str(h.id),
            )
            for h in hosts
            if h.host_ip
        ]

    def _cluster_bastion_candidates(self, project_id: int) -> list[AgentHostCandidate]:
        clusters = self.db.query(KubernetesCluster).filter(KubernetesCluster.project_id == project_id).all()
        all_creds = self.db.query(SSHCredential).order_by(SSHCredential.is_default.desc()).all()
        default_cred_id = all_creds[0].id if all_creds else None
        candidates: list[AgentHostCandidate] = []
        for cluster in clusters:
            host_ip = cluster.ssh_host_override
            if not host_ip and cluster.ssh_credential:
                host_ip = cluster.ssh_credential.host
            if not host_ip and cluster.api_server:
                parsed = urlparse(cluster.api_server)
                host_ip = parsed.hostname
            if not host_ip:
                host_ip = cluster.name

            cred_id = cluster.ssh_credential_id or default_cred_id
            cp = (cluster.cloud_provider or "K8s").upper()
            candidates.append(
                AgentHostCandidate(
                    label=f"{cp} Cluster Host — {cluster.name} ({cluster.region or host_ip})",
                    host_ip=host_ip,
                    ssh_credential_id=cred_id,
                    ssh_port=22,
                    source="cluster_bastion",
                    source_ref=str(cluster.id),
                )
            )
        return candidates

    def _ssh_credential_candidates(self, project_id: int) -> list[AgentHostCandidate]:
        allowed_ids: set[int] = set()

        project = self.db.query(Project).filter(Project.id == project_id).first()
        if project is not None and getattr(project, "ssh_credential_id", None) is not None:
            allowed_ids.add(project.ssh_credential_id)

        cluster_cred_ids = (
            self.db.query(KubernetesCluster.ssh_credential_id)
            .filter(
                KubernetesCluster.project_id == project_id,
                KubernetesCluster.ssh_credential_id.isnot(None),
            )
            .all()
        )
        allowed_ids.update(cid for (cid,) in cluster_cred_ids)

        if not allowed_ids:
            prefix_only = (
                self.db.query(SSHCredential)
                .filter(SSHCredential.name.startswith(f"aws-jumphost-proj{project_id}-"))
                .order_by(SSHCredential.name)
                .all()
            )
            return [
                AgentHostCandidate(
                    label=f"SSH: {c.name} ({c.username}@{c.host})",
                    host_ip=c.host,
                    ssh_credential_id=c.id,
                    ssh_port=c.port or 22,
                    source="ssh_credential",
                    source_ref=str(c.id),
                    last_test_status=c.last_test_status,
                )
                for c in prefix_only
                if c.host
            ]

        creds = (
            self.db.query(SSHCredential)
            .filter(
                (SSHCredential.id.in_(allowed_ids)) | (SSHCredential.name.startswith(f"aws-jumphost-proj{project_id}-"))
            )
            .order_by(SSHCredential.name)
            .all()
        )
        return [
            AgentHostCandidate(
                label=f"SSH: {c.name} ({c.username}@{c.host})",
                host_ip=c.host,
                ssh_credential_id=c.id,
                ssh_port=c.port or 22,
                source="ssh_credential",
                source_ref=str(c.id),
                last_test_status=c.last_test_status,
            )
            for c in creds
            if c.host
        ]
