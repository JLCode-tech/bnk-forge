"""Kubernetes Job Controller for Ephemeral Batch Workloads.

Offloads long-running and resource-intensive batch workloads (such as F5 QKView
diagnostic bundle generation and distributed aiperf benchmark sweeps) from fixed
worker daemons to Ephemeral Kubernetes Jobs (batch/v1).

Reference: docs/architecture/DATA_PLATFORM.md (Section 3.2: Ephemeral Kubernetes Jobs).
"""

from __future__ import annotations

import logging
import os
import time
import uuid
from dataclasses import asdict, dataclass
from typing import Any

try:
    from kubernetes import client as k8s_client
    from kubernetes import config as k8s_config
    from kubernetes.client.rest import ApiException
    K8S_AVAILABLE = True
except ImportError:
    k8s_client = None  # type: ignore[assignment]
    k8s_config = None  # type: ignore[assignment]
    ApiException = Exception  # type: ignore[assignment,misc]
    K8S_AVAILABLE = False

logger = logging.getLogger(__name__)

DEFAULT_JOB_NAMESPACE = os.environ.get("FORGE_JOB_NAMESPACE", "forge-system")
MAX_K8S_NAME_LEN = 63


def _sanitize_name(value: str) -> str:
    """Coerce an arbitrary string into a valid DNS-1123 label fragment."""
    out: list[str] = []
    for ch in value.lower():
        if ch.isalnum() or ch == "-":
            out.append(ch)
        else:
            out.append("-")
    cleaned = "".join(out).strip("-") or "x"
    return cleaned[:36]


@dataclass
class JobExecutionInfo:
    """Standard execution summary returned by job operations."""

    job_name: str
    namespace: str
    job_type: str
    status: str  # Pending, Running, Succeeded, Failed, Unknown
    active: int = 0
    succeeded: int = 0
    failed: int = 0
    start_time: str | None = None
    completion_time: str | None = None
    ttl_seconds_after_finished: int = 3600
    details: dict[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class K8sJobService:
    """Controller for provisioning and managing ephemeral batch/v1 Kubernetes Jobs."""

    def __init__(
        self,
        namespace: str = DEFAULT_JOB_NAMESPACE,
        kubeconfig_path: str | None = None,
        mock_mode: bool | None = None,
    ) -> None:
        self.namespace = namespace
        self._mock_jobs: dict[str, dict[str, Any]] = {}

        if mock_mode is not None:
            self.mock_mode = mock_mode
        else:
            # Check environment override
            env_mock = os.environ.get("K8S_MOCK_MODE", "").lower() in ("1", "true", "yes")
            if env_mock or not K8S_AVAILABLE:
                self.mock_mode = True
            else:
                self.mock_mode = not self._try_init_k8s_client(kubeconfig_path)

        logger.info(
            "K8sJobService initialized (namespace=%s, mock_mode=%s)",
            self.namespace,
            self.mock_mode,
        )

    def _try_init_k8s_client(self, kubeconfig_path: str | None) -> bool:
        """Attempt to configure Kubernetes client from in-cluster service account or kubeconfig."""
        if not K8S_AVAILABLE:
            return False

        try:
            if kubeconfig_path:
                k8s_config.load_kube_config(config_file=kubeconfig_path)
            elif os.path.exists(os.path.expanduser("~/.kube/config")):
                k8s_config.load_kube_config()
            else:
                k8s_config.load_incluster_config()

            self.batch_v1 = k8s_client.BatchV1Api()
            self.core_v1 = k8s_client.CoreV1Api()
            return True
        except Exception as exc:
            logger.debug("Failed to initialize Kubernetes API client: %s. Using mock mode.", exc)
            return False

    # -------------------------------------------------------------------------
    # QKView Diagnostic Dump Jobs
    # -------------------------------------------------------------------------
    def create_qkview_job(
        self,
        cluster_id: str | int,
        bundle_id: str | None = None,
        s3_bucket: str = "forge-diagnostics",
        namespace: str | None = None,
        image: str = "registry.internal/forge/qkview-collector:v1.1.0",
        cpu_limit: str = "2",
        memory_limit: str = "6Gi",
        ttl_seconds_after_finished: int = 3600,
        extra_env: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        """Spawn an Ephemeral Kubernetes Job to gather an F5 QKView diagnostic bundle.

        Replaces Celery worker execution to eliminate OOM risks on fixed worker pools.
        """
        ns = namespace or self.namespace
        bid = bundle_id or uuid.uuid4().hex[:12]
        c_sanitized = _sanitize_name(str(cluster_id))
        b_sanitized = _sanitize_name(bid)[:16]
        raw_name = f"forge-qkview-{c_sanitized}-{b_sanitized}"
        job_name = raw_name[:MAX_K8S_NAME_LEN].rstrip("-")

        labels = {
            "app.kubernetes.io/name": "forge-qkview",
            "app.kubernetes.io/part-of": "bnk-forge",
            "app.kubernetes.io/managed-by": "bnk-forge",
            "forge.f5.com/job-type": "qkview-collection",
            "forge.f5.com/cluster-id": _sanitize_name(str(cluster_id)),
            "forge.f5.com/bundle-id": b_sanitized,
        }

        env_map = {
            "TARGET_CLUSTER_ID": str(cluster_id),
            "BUNDLE_ID": bid,
            "S3_UPLOAD_BUCKET": s3_bucket,
            "NATS_URL": os.environ.get("NATS_URL", "nats://localhost:4222"),
            "FORGE_TASK_STREAM": "FORGE_TASKS",
        }
        if extra_env:
            env_map.update(extra_env)

        if self.mock_mode:
            info = JobExecutionInfo(
                job_name=job_name,
                namespace=ns,
                job_type="qkview-collection",
                status="Running",
                active=1,
                ttl_seconds_after_finished=ttl_seconds_after_finished,
                start_time=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                details={
                    "cluster_id": str(cluster_id),
                    "bundle_id": bid,
                    "s3_bucket": s3_bucket,
                    "image": image,
                    "cpu_limit": cpu_limit,
                    "memory_limit": memory_limit,
                },
            )
            self._mock_jobs[f"{ns}/{job_name}"] = info.to_dict()
            return info.to_dict()

        # Build Kubernetes batch/v1 Job Spec
        container_env = [
            k8s_client.V1EnvVar(name=k, value=str(v)) for k, v in env_map.items()
        ]

        resources = k8s_client.V1ResourceRequirements(
            limits={"cpu": cpu_limit, "memory": memory_limit},
            requests={"cpu": "500m", "memory": "1Gi"},
        )

        container = k8s_client.V1Container(
            name="qkview-collector",
            image=image,
            resources=resources,
            env=container_env,
        )

        template = k8s_client.V1PodTemplateSpec(
            metadata=k8s_client.V1ObjectMeta(labels=labels),
            spec=k8s_client.V1PodSpec(
                restart_policy="Never",
                containers=[container],
            ),
        )

        job_spec = k8s_client.V1JobSpec(
            ttl_seconds_after_finished=ttl_seconds_after_finished,
            backoff_limit=1,
            active_deadline_seconds=ttl_seconds_after_finished,
            template=template,
        )

        job_body = k8s_client.V1Job(
            api_version="batch/v1",
            kind="Job",
            metadata=k8s_client.V1ObjectMeta(name=job_name, namespace=ns, labels=labels),
            spec=job_spec,
        )

        try:
            created = self.batch_v1.create_namespaced_job(namespace=ns, body=job_body)
            return JobExecutionInfo(
                job_name=created.metadata.name,
                namespace=ns,
                job_type="qkview-collection",
                status="Running",
                active=1,
                ttl_seconds_after_finished=ttl_seconds_after_finished,
                start_time=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                details={"cluster_id": str(cluster_id), "bundle_id": bid},
            ).to_dict()
        except ApiException as e:
            logger.error("Failed to create qkview batch job %s: %s", job_name, e)
            raise

    # -------------------------------------------------------------------------
    # aiperf LLM Benchmark Jobs
    # -------------------------------------------------------------------------
    def create_aiperf_job(
        self,
        benchmark_id: str | int,
        target_url: str,
        model_name: str,
        namespace: str | None = None,
        image: str = "registry.internal/forge/aiperf-runner:v1.0.0",
        concurrency: int = 1,
        cpu_limit: str = "4",
        memory_limit: str = "8Gi",
        ttl_seconds_after_finished: int = 3600,
        extra_env: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        """Spawn an Ephemeral Kubernetes Job to execute a distributed aiperf LLM benchmark sweep."""
        ns = namespace or self.namespace
        bench_sanitized = _sanitize_name(str(benchmark_id))[:30]
        raw_name = f"forge-aiperf-{bench_sanitized}"
        job_name = raw_name[:MAX_K8S_NAME_LEN].rstrip("-")

        labels = {
            "app.kubernetes.io/name": "forge-aiperf",
            "app.kubernetes.io/part-of": "bnk-forge",
            "app.kubernetes.io/managed-by": "bnk-forge",
            "forge.f5.com/job-type": "aiperf-benchmark",
            "forge.f5.com/benchmark-id": bench_sanitized,
        }

        env_map = {
            "BENCHMARK_ID": str(benchmark_id),
            "TARGET_URL": target_url,
            "MODEL_NAME": model_name,
            "CONCURRENCY": str(concurrency),
            "NATS_URL": os.environ.get("NATS_URL", "nats://localhost:4222"),
            "FORGE_TASK_STREAM": "FORGE_TASKS",
        }
        if extra_env:
            env_map.update(extra_env)

        if self.mock_mode:
            info = JobExecutionInfo(
                job_name=job_name,
                namespace=ns,
                job_type="aiperf-benchmark",
                status="Running",
                active=1,
                ttl_seconds_after_finished=ttl_seconds_after_finished,
                start_time=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                details={
                    "benchmark_id": str(benchmark_id),
                    "target_url": target_url,
                    "model_name": model_name,
                    "concurrency": concurrency,
                    "image": image,
                    "cpu_limit": cpu_limit,
                    "memory_limit": memory_limit,
                },
            )
            self._mock_jobs[f"{ns}/{job_name}"] = info.to_dict()
            return info.to_dict()

        container_env = [
            k8s_client.V1EnvVar(name=k, value=str(v)) for k, v in env_map.items()
        ]

        resources = k8s_client.V1ResourceRequirements(
            limits={"cpu": cpu_limit, "memory": memory_limit},
            requests={"cpu": "1", "memory": "2Gi"},
        )

        container = k8s_client.V1Container(
            name="aiperf-runner",
            image=image,
            resources=resources,
            env=container_env,
        )

        template = k8s_client.V1PodTemplateSpec(
            metadata=k8s_client.V1ObjectMeta(labels=labels),
            spec=k8s_client.V1PodSpec(
                restart_policy="Never",
                containers=[container],
            ),
        )

        job_spec = k8s_client.V1JobSpec(
            ttl_seconds_after_finished=ttl_seconds_after_finished,
            backoff_limit=1,
            active_deadline_seconds=ttl_seconds_after_finished,
            template=template,
        )

        job_body = k8s_client.V1Job(
            api_version="batch/v1",
            kind="Job",
            metadata=k8s_client.V1ObjectMeta(name=job_name, namespace=ns, labels=labels),
            spec=job_spec,
        )

        try:
            created = self.batch_v1.create_namespaced_job(namespace=ns, body=job_body)
            return JobExecutionInfo(
                job_name=created.metadata.name,
                namespace=ns,
                job_type="aiperf-benchmark",
                status="Running",
                active=1,
                ttl_seconds_after_finished=ttl_seconds_after_finished,
                start_time=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                details={"benchmark_id": str(benchmark_id), "target_url": target_url},
            ).to_dict()
        except ApiException as e:
            logger.error("Failed to create aiperf batch job %s: %s", job_name, e)
            raise

    # -------------------------------------------------------------------------
    # Status and Lifecycle
    # -------------------------------------------------------------------------
    def get_job_status(self, job_name: str, namespace: str | None = None) -> dict[str, Any]:
        """Fetch current status and phase of a batch/v1 Job."""
        ns = namespace or self.namespace
        key = f"{ns}/{job_name}"

        if self.mock_mode:
            if key in self._mock_jobs:
                return self._mock_jobs[key]
            return JobExecutionInfo(
                job_name=job_name,
                namespace=ns,
                job_type="unknown",
                status="NotFound",
            ).to_dict()

        try:
            job = self.batch_v1.read_namespaced_job_status(name=job_name, namespace=ns)
            status_obj = job.status

            if status_obj.succeeded and status_obj.succeeded > 0:
                phase = "Succeeded"
            elif status_obj.failed and status_obj.failed > 0:
                phase = "Failed"
            elif status_obj.active and status_obj.active > 0:
                phase = "Running"
            else:
                phase = "Pending"

            labels = job.metadata.labels or {}
            job_type = labels.get("forge.f5.com/job-type", "unknown")

            start_t = (
                status_obj.start_time.isoformat() if status_obj.start_time else None
            )
            completion_t = (
                status_obj.completion_time.isoformat()
                if status_obj.completion_time
                else None
            )

            return JobExecutionInfo(
                job_name=job_name,
                namespace=ns,
                job_type=job_type,
                status=phase,
                active=status_obj.active or 0,
                succeeded=status_obj.succeeded or 0,
                failed=status_obj.failed or 0,
                start_time=start_t,
                completion_time=completion_t,
            ).to_dict()
        except ApiException as e:
            if e.status == 404:
                return JobExecutionInfo(
                    job_name=job_name,
                    namespace=ns,
                    job_type="unknown",
                    status="NotFound",
                ).to_dict()
            raise

    def set_mock_job_status(
        self,
        job_name: str,
        status: str,
        namespace: str | None = None,
        succeeded: int = 0,
        failed: int = 0,
    ) -> None:
        """Utility for unit tests to transition a mock job state."""
        ns = namespace or self.namespace
        key = f"{ns}/{job_name}"
        if key in self._mock_jobs:
            self._mock_jobs[key]["status"] = status
            self._mock_jobs[key]["succeeded"] = succeeded
            self._mock_jobs[key]["failed"] = failed
            if status in ("Succeeded", "Failed"):
                self._mock_jobs[key]["active"] = 0
                self._mock_jobs[key]["completion_time"] = time.strftime(
                    "%Y-%m-%dT%H:%M:%SZ", time.gmtime()
                )

    def delete_job(
        self,
        job_name: str,
        namespace: str | None = None,
        propagation_policy: str = "Background",
    ) -> bool:
        """Delete an existing Job and its underlying pods."""
        ns = namespace or self.namespace
        key = f"{ns}/{job_name}"

        if self.mock_mode:
            if key in self._mock_jobs:
                del self._mock_jobs[key]
                return True
            return False

        try:
            self.batch_v1.delete_namespaced_job(
                name=job_name,
                namespace=ns,
                propagation_policy=propagation_policy,
            )
            return True
        except ApiException as e:
            if e.status == 404:
                return False
            raise

    def list_jobs(
        self, namespace: str | None = None, job_type: str | None = None
    ) -> list[dict[str, Any]]:
        """List active or completed forge jobs in the specified namespace."""
        ns = namespace or self.namespace

        if self.mock_mode:
            results = []
            for k, job in self._mock_jobs.items():
                if k.startswith(f"{ns}/"):
                    if job_type is None or job.get("job_type") == job_type:
                        results.append(job)
            return results

        label_selector = "app.kubernetes.io/managed-by=bnk-forge"
        if job_type:
            label_selector += f",forge.f5.com/job-type={job_type}"

        try:
            job_list = self.batch_v1.list_namespaced_job(
                namespace=ns, label_selector=label_selector
            )
            results = []
            for job in job_list.items:
                j_status = job.status
                if j_status.succeeded and j_status.succeeded > 0:
                    phase = "Succeeded"
                elif j_status.failed and j_status.failed > 0:
                    phase = "Failed"
                elif j_status.active and j_status.active > 0:
                    phase = "Running"
                else:
                    phase = "Pending"

                labels = job.metadata.labels or {}
                results.append(
                    JobExecutionInfo(
                        job_name=job.metadata.name,
                        namespace=ns,
                        job_type=labels.get("forge.f5.com/job-type", "unknown"),
                        status=phase,
                        active=j_status.active or 0,
                        succeeded=j_status.succeeded or 0,
                        failed=j_status.failed or 0,
                    ).to_dict()
                )
            return results
        except ApiException as e:
            logger.error("Failed to list batch jobs in %s: %s", ns, e)
            raise
