"""
Unit tests for CLI task YAML rendering.

Tests _render_awsbnkctl_cluster_yaml to verify cluster.yaml generation
for external-only and dual-interface patterns, dataPath blocks, and
CIDR derivation from vpc_cidr.
"""

import pytest
import yaml

from tasks.cli_tasks import _render_awsbnkctl_cluster_yaml


def _base_vars(**overrides) -> dict:
    vars_dict = {
        "cluster_name": "test-cluster",
        "region": "us-east-1",
        "vpc_cidr": "10.0.0.0/16",
        "instance_type": "m5.2xlarge",
        "pattern": "external-only",
    }
    vars_dict.update(overrides)
    return vars_dict


class TestCliClusterYamlRendering:
    """Test cluster.yaml rendering for awsbnkctl."""

    @pytest.mark.parametrize(
        "pattern,has_internal",
        [
            ("external-only", False),
            ("dual-interface", True),
        ],
    )
    def test_render_patterns(self, pattern, has_internal):
        variables = _base_vars(pattern=pattern, instance_type="m5.2xlarge")
        config = yaml.safe_load(_render_awsbnkctl_cluster_yaml(variables))

        assert config["apiVersion"] == "awsbnkctl/v1"
        assert config["kind"] == "Cluster"
        assert config["metadata"]["name"] == "test-cluster"
        assert config["metadata"]["region"] == "us-east-1"
        assert config["pattern"] == pattern
        assert config["network"]["vpcCidr"] == "10.0.0.0/16"
        assert config["network"]["azs"] == ["us-east-1a", "us-east-1b"]
        assert len(config["network"]["subnets"]["public"]) == 2
        assert len(config["network"]["subnets"]["private"]) == 2

        data_path = config["network"]["dataPath"]
        assert "external" in data_path
        assert "cidr" in data_path["external"] and "az" in data_path["external"]

        if has_internal:
            assert "internal" in data_path
            assert "cidr" in data_path["internal"] and "az" in data_path["internal"]
            assert data_path["external"]["cidr"] != data_path["internal"]["cidr"]
        else:
            assert "internal" not in data_path

        ng = config["cluster"]["nodeGroups"][0]
        assert ng["instanceType"] == "m5.2xlarge"
        assert ng["desiredSize"] == 3
        assert set(ng.keys()) == {"name", "desiredSize", "minSize", "maxSize", "instanceType"}
        assert "bnk" not in config

    def test_render_with_custom_vpc_cidr(self):
        variables = _base_vars(vpc_cidr="192.168.0.0/16")
        config = yaml.safe_load(_render_awsbnkctl_cluster_yaml(variables))
        assert config["network"]["vpcCidr"] == "192.168.0.0/16"
        for subnet in config["network"]["subnets"]["public"] + config["network"]["subnets"]["private"]:
            assert subnet["cidr"].startswith("192.168")
        assert "bnk" not in config

    def test_render_defaults_when_variables_missing(self):
        config = yaml.safe_load(_render_awsbnkctl_cluster_yaml({}))
        assert config["metadata"]["name"] == "bnk-demo"
        assert config["metadata"]["region"] == "ap-southeast-2"
        assert config["network"]["vpcCidr"] == "10.0.0.0/16"
        assert config["cluster"]["nodeGroups"][0]["instanceType"] == "m5.2xlarge"
        assert config["pattern"] == "external-only"
        assert "bnk" not in config

    @pytest.mark.parametrize(
        "region,expected_azs",
        [
            ("us-east-1", ["us-east-1a", "us-east-1b"]),
            ("eu-west-1", ["eu-west-1a", "eu-west-1b"]),
            ("ap-southeast-2", ["ap-southeast-2a", "ap-southeast-2b"]),
        ],
    )
    def test_azs_derived_from_region(self, region, expected_azs):
        config = yaml.safe_load(_render_awsbnkctl_cluster_yaml(_base_vars(region=region)))
        assert config["network"]["azs"] == expected_azs


class TestCliClusterYamlBnkBlock:
    """Test the bnk: block emission logic."""

    @pytest.mark.parametrize(
        "far,jwt,should_emit",
        [
            ("./secrets/cne_pull_64.json", "./secrets/license.jwt", True),
            (None, "./secrets/license.jwt", False),
            ("./secrets/cne_pull_64.json", None, False),
            (None, None, False),
        ],
    )
    def test_bnk_block_presence(self, far, jwt, should_emit):
        config = yaml.safe_load(_render_awsbnkctl_cluster_yaml(_base_vars(), far_archive_path=far, jwt_path=jwt))
        if should_emit:
            assert "bnk" in config
            assert config["bnk"]["farArchive"] == far
            assert config["bnk"]["jwt"] == jwt
            assert config["bnk"]["farArchive"].startswith("./")
            assert config["bnk"]["jwt"].startswith("./")
        else:
            assert "bnk" not in config


class TestCliDemoBlocks:
    """Tests for the 4 demo-layer cluster.yaml blocks."""

    @pytest.mark.parametrize(
        "overrides",
        [
            {},
            {
                "demo_enabled": False,
                "jumphost_enabled": False,
                "bigipve_enabled": False,
                "ai_sagemaker_enabled": False,
            },
            {
                "demo_enabled": "false",
                "jumphost_enabled": "0",
                "bigipve_enabled": "no",
                "ai_sagemaker_enabled": "False",
            },
        ],
    )
    def test_all_disabled_no_demo_blocks(self, overrides):
        config = yaml.safe_load(_render_awsbnkctl_cluster_yaml(_base_vars(**overrides)))
        for key in ("testing", "demo", "bigipVE", "ai"):
            assert key not in config

    @pytest.mark.parametrize("enabled_val", [True, "true"])
    def test_jumphost_block(self, enabled_val):
        config = yaml.safe_load(
            _render_awsbnkctl_cluster_yaml(_base_vars(jumphost_enabled=enabled_val, jumphost_instance_type="t3.small"))
        )
        assert config["testing"]["jumphost"]["enabled"] is True
        assert config["testing"]["jumphost"]["instanceType"] == "t3.small"

    @pytest.mark.parametrize(
        "ttl_in,expected_ttl",
        [
            ("48h", "48h"),
            (None, "24h"),
        ],
    )
    def test_demo_block(self, ttl_in, expected_ttl):
        kwargs = {"demo_enabled": True, "jumphost_enabled": False}
        if ttl_in:
            kwargs["demo_ttl"] = ttl_in
        config = yaml.safe_load(_render_awsbnkctl_cluster_yaml(_base_vars(**kwargs)))
        assert config["demo"]["enabled"] is True
        assert config["demo"]["ttl"] == expected_ttl
        # Demo auto-enables jumphost
        assert config["testing"]["jumphost"]["enabled"] is True

    @pytest.mark.parametrize(
        "vpc_cidr,vip_in,expected_vip",
        [
            ("10.0.0.0/16", "10.0.10.99", "10.0.10.99"),
            ("172.31.0.0/16", "", "172.31.10.120"),
            ("10.0.0.0/16", "", "10.0.10.120"),
        ],
    )
    def test_bigipve_block(self, vpc_cidr, vip_in, expected_vip):
        config = yaml.safe_load(
            _render_awsbnkctl_cluster_yaml(
                _base_vars(
                    pattern="external-only",
                    vpc_cidr=vpc_cidr,
                    bigipve_enabled=True,
                    bigipve_instance_type="c5n.2xlarge",
                    bigipve_license_tier="Better",
                    bigipve_vip=vip_in,
                )
            )
        )
        assert config["bigipVE"]["enabled"] is True
        assert config["bigipVE"]["instanceType"] == "c5n.2xlarge"
        assert config["bigipVE"]["licenseTier"] == "Better"
        assert config["bigipVE"]["vip"] == expected_vip
        # Forces dual-interface and internal datapath
        assert config["pattern"] == "dual-interface"
        assert "internal" in config["network"]["dataPath"]

    @pytest.mark.parametrize(
        "enabled_val,model_in,expected_model",
        [
            (True, "mistralai/Mistral-7B-Instruct-v0.2", "mistralai/Mistral-7B-Instruct-v0.2"),
            ("1", "", "meta-llama/Meta-Llama-3-8B-Instruct"),
            (True, None, "meta-llama/Meta-Llama-3-8B-Instruct"),
        ],
    )
    def test_ai_sagemaker_block(self, enabled_val, model_in, expected_model):
        kwargs = {"ai_sagemaker_enabled": enabled_val}
        if model_in is not None:
            kwargs["ai_sagemaker_model"] = model_in
        config = yaml.safe_load(_render_awsbnkctl_cluster_yaml(_base_vars(**kwargs)))
        assert config["ai"]["sagemaker"]["enabled"] is True
        assert config["ai"]["sagemaker"]["model"] == expected_model

    def test_all_blocks_enabled_together(self):
        config = yaml.safe_load(
            _render_awsbnkctl_cluster_yaml(
                _base_vars(
                    jumphost_enabled=True,
                    jumphost_instance_type="t3.medium",
                    demo_enabled=True,
                    demo_ttl="72h",
                    bigipve_enabled=True,
                    bigipve_instance_type="c5n.4xlarge",
                    bigipve_license_tier="Best",
                    bigipve_vip="10.0.10.55",
                    ai_sagemaker_enabled=True,
                )
            )
        )
        assert config["apiVersion"] == "awsbnkctl/v1"
        assert config["pattern"] == "dual-interface"
        assert config["testing"]["jumphost"]["instanceType"] == "t3.medium"
        assert config["demo"]["ttl"] == "72h"
        assert config["bigipVE"]["instanceType"] == "c5n.4xlarge"
        assert config["bigipVE"]["licenseTier"] == "Best"
        assert config["bigipVE"]["vip"] == "10.0.10.55"
        assert config["ai"]["sagemaker"]["enabled"] is True
        assert "internal" in config["network"]["dataPath"]


class TestCliClusterYamlInjection:
    """Regression tests: user-supplied values cannot inject malformed YAML."""

    @pytest.mark.parametrize(
        "var_key,var_value,expected_path,expected_val",
        [
            ("cluster_name", "foo: bar", ("metadata", "name"), "foo: bar"),
            ("cluster_name", "*anchor", ("metadata", "name"), "*anchor"),
            ("cluster_name", "{injection}", ("metadata", "name"), "{injection}"),
            ("region", "us-east-1 # comment", ("metadata", "region"), "us-east-1 # comment"),
            ("instance_type", 'm5.2xlarge" evil', ("cluster", "nodeGroups", 0, "instanceType"), 'm5.2xlarge" evil'),
            ("demo_ttl", "24h%", ("demo", "ttl"), "24h%"),
            (
                "ai_sagemaker_model",
                "meta-llama/Meta-Llama-3-8B-Instruct",
                ("ai", "sagemaker", "model"),
                "meta-llama/Meta-Llama-3-8B-Instruct",
            ),
        ],
    )
    def test_special_chars_produce_valid_yaml(self, var_key, var_value, expected_path, expected_val):
        kwargs = {var_key: var_value}
        if "demo" in var_key:
            kwargs["demo_enabled"] = True
        elif "ai" in var_key:
            kwargs["ai_sagemaker_enabled"] = True
        config = yaml.safe_load(_render_awsbnkctl_cluster_yaml(_base_vars(**kwargs)))

        curr = config
        for step in expected_path:
            curr = curr[step]
        assert curr == expected_val

    def test_jumphost_instance_type_with_newline_produces_valid_yaml(self):
        config = yaml.safe_load(
            _render_awsbnkctl_cluster_yaml(
                _base_vars(
                    jumphost_enabled=True,
                    jumphost_instance_type="t3.small\nevil: injected",
                )
            )
        )
        assert "evil" not in config
        assert "\nevil: injected" in config["testing"]["jumphost"]["instanceType"]

    def test_bnk_block_paths_with_special_chars(self):
        far = "./secrets/cne pull (64).json"
        jwt = "./secrets/license: v2.jwt"
        config = yaml.safe_load(
            _render_awsbnkctl_cluster_yaml(
                _base_vars(),
                far_archive_path=far,
                jwt_path=jwt,
            )
        )
        assert config["bnk"]["farArchive"] == far
        assert config["bnk"]["jwt"] == jwt


class TestCliPlanDryRunNoUsecases:
    """Regression: dry-run plan with no use-cases selected."""

    def test_plan_usecases_none_returns_has_changes_false_and_skipped_true(self):
        from unittest.mock import MagicMock

        from services.execution.cli_engine import BnkctlEngine

        engine = BnkctlEngine()
        ctx = MagicMock()
        ctx.variables = {"usecases": "none", "bnkctl_action": "demo-usecases"}
        ctx.project_id = 1
        ctx.module_id = 1

        result = engine._plan_usecases(ctx, on_output=None)
        assert result.has_changes is False
        assert result.skipped is True

    @pytest.mark.parametrize(
        "has_changes,skipped,details,expected_success",
        [
            (False, True, "no use-cases selected — skipped", True),
            (False, False, "cluster.yaml not found in workspace", False),
            (False, False, "use-case dry-run failed:\nError: cannot connect", False),
            (
                False,
                False,
                "dry-run failed (exit 1):\nPhase 04/25: some-phase skipped (already applied)\nPhase 05/25: fatal error",
                False,
            ),
        ],
    )
    def test_plan_task_success_logic(self, has_changes, skipped, details, expected_success):
        from services.execution.engine_interface import PlanResult

        plan_result = PlanResult(has_changes=has_changes, skipped=skipped, details=details)
        success = bool(plan_result.has_changes or plan_result.skipped)
        assert success is expected_success
