"""Unit tests for Ephemeral Kubernetes Job Controller (k8s_job_service.py)."""

from unittest.mock import MagicMock, patch

import pytest

from services.k8s_job_service import (
    JobExecutionInfo,
    K8sJobService,
    _sanitize_name,
)


class TestSanitizeName:
    def test_alphanumeric_lowercased(self):
        assert _sanitize_name("Cluster123") == "cluster123"

    def test_special_characters_replaced_with_hyphen(self):
        assert _sanitize_name("my_cluster.east#1") == "my-cluster-east-1"

    def test_leading_trailing_hyphens_stripped(self):
        assert _sanitize_name("---test-name---") == "test-name"

    def test_empty_string_fallback(self):
        assert _sanitize_name("") == "x"

    def test_truncation(self):
        long_str = "a" * 50
        assert len(_sanitize_name(long_str)) <= 36


class TestK8sJobServiceMockMode:
    @pytest.fixture
    def job_service(self):
        return K8sJobService(namespace="forge-test", mock_mode=True)

    def test_create_qkview_job(self, job_service):
        job = job_service.create_qkview_job(
            cluster_id="cls-9481a",
            bundle_id="bndl-001",
            s3_bucket="custom-bucket",
            cpu_limit="4",
            memory_limit="8Gi",
        )
        assert job["job_name"].startswith("forge-qkview-cls-9481a")
        assert job["namespace"] == "forge-test"
        assert job["job_type"] == "qkview-collection"
        assert job["status"] == "Running"
        assert job["active"] == 1
        assert job["ttl_seconds_after_finished"] == 3600
        assert job["details"]["cluster_id"] == "cls-9481a"
        assert job["details"]["s3_bucket"] == "custom-bucket"

    def test_create_aiperf_job(self, job_service):
        job = job_service.create_aiperf_job(
            benchmark_id="bench-456",
            target_url="http://vllm-service:8000/v1",
            model_name="meta-llama/Llama-3-70b",
            concurrency=8,
        )
        assert job["job_name"] == "forge-aiperf-bench-456"
        assert job["namespace"] == "forge-test"
        assert job["job_type"] == "aiperf-benchmark"
        assert job["status"] == "Running"
        assert job["details"]["concurrency"] == 8
        assert job["details"]["target_url"] == "http://vllm-service:8000/v1"

    def test_get_job_status_and_lifecycle(self, job_service):
        job = job_service.create_qkview_job(cluster_id="cls-1", bundle_id="b-1")
        name = job["job_name"]

        status = job_service.get_job_status(name)
        assert status["status"] == "Running"
        assert status["active"] == 1

        # Simulate job completion
        job_service.set_mock_job_status(name, status="Succeeded", succeeded=1)
        updated = job_service.get_job_status(name)
        assert updated["status"] == "Succeeded"
        assert updated["active"] == 0
        assert updated["succeeded"] == 1
        assert updated["completion_time"] is not None

    def test_get_job_status_not_found(self, job_service):
        res = job_service.get_job_status("nonexistent-job")
        assert res["status"] == "NotFound"

    def test_delete_job(self, job_service):
        job = job_service.create_qkview_job(cluster_id="cls-1", bundle_id="b-2")
        name = job["job_name"]

        assert job_service.delete_job(name) is True
        assert job_service.get_job_status(name)["status"] == "NotFound"
        # Deleting already deleted job returns False
        assert job_service.delete_job(name) is False

    def test_list_jobs_and_filter(self, job_service):
        job_service.create_qkview_job(cluster_id="cls-1", bundle_id="b-1")
        job_service.create_qkview_job(cluster_id="cls-2", bundle_id="b-2")
        job_service.create_aiperf_job(
            benchmark_id="bench-1",
            target_url="http://x",
            model_name="m1",
        )

        all_jobs = job_service.list_jobs()
        assert len(all_jobs) == 3

        qkviews = job_service.list_jobs(job_type="qkview-collection")
        assert len(qkviews) == 2
        assert all(j["job_type"] == "qkview-collection" for j in qkviews)

        benchmarks = job_service.list_jobs(job_type="aiperf-benchmark")
        assert len(benchmarks) == 1
        assert benchmarks[0]["job_type"] == "aiperf-benchmark"


class TestK8sJobServiceK8sClientCalls:
    @patch("services.k8s_job_service.K8S_AVAILABLE", True)
    def test_create_qkview_job_k8s_api(self):
        service = K8sJobService(namespace="forge-system", mock_mode=False)
        mock_batch = MagicMock()
        mock_job_response = MagicMock()
        mock_job_response.metadata.name = "forge-qkview-cls-1-bndl-1"
        mock_batch.create_namespaced_job.return_value = mock_job_response
        service.batch_v1 = mock_batch

        res = service.create_qkview_job(
            cluster_id="cls-1",
            bundle_id="bndl-1",
            s3_bucket="s3://test",
            cpu_limit="2",
            memory_limit="6Gi",
        )

        assert res["job_name"] == "forge-qkview-cls-1-bndl-1"
        assert res["namespace"] == "forge-system"
        mock_batch.create_namespaced_job.assert_called_once()

        call_args = mock_batch.create_namespaced_job.call_args
        assert call_args.kwargs["namespace"] == "forge-system"
        body = call_args.kwargs["body"]
        assert body.api_version == "batch/v1"
        assert body.kind == "Job"
        assert body.spec.ttl_seconds_after_finished == 3600
        assert body.spec.template.spec.restart_policy == "Never"
        container = body.spec.template.spec.containers[0]
        assert container.name == "qkview-collector"
        assert container.resources.limits["memory"] == "6Gi"

    @patch("services.k8s_job_service.K8S_AVAILABLE", True)
    def test_create_aiperf_job_k8s_api(self):
        service = K8sJobService(namespace="forge-system", mock_mode=False)
        mock_batch = MagicMock()
        mock_job_response = MagicMock()
        mock_job_response.metadata.name = "forge-aiperf-bench-10"
        mock_batch.create_namespaced_job.return_value = mock_job_response
        service.batch_v1 = mock_batch

        res = service.create_aiperf_job(
            benchmark_id="bench-10",
            target_url="http://llm:8000",
            model_name="mistral-7b",
        )

        assert res["job_name"] == "forge-aiperf-bench-10"
        mock_batch.create_namespaced_job.assert_called_once()
        body = mock_batch.create_namespaced_job.call_args.kwargs["body"]
        container = body.spec.template.spec.containers[0]
        assert container.name == "aiperf-runner"
        assert container.resources.limits["cpu"] == "4"
        assert container.resources.limits["memory"] == "8Gi"
