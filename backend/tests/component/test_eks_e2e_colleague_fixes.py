"""
Component and unit tests for AWS EKS E2E deployment & teardown reliability fixes:
- Fix #2: cne_pull_secret / jwt_token file-secret fallback, raw JSON normalization,
  Helm registry login raw JSON + base64 handling, and variable_assembler sibling fallback.
- Fix #3: register_eks_cluster region extraction from ARN/outputs/variable_defaults,
  in-place upsert on re-creation, stale row pruning, unregister_eks_cluster by
  source_module_id / outputs, opentofu destroy unregistration for catalog EKS modules,
  and EngineRouter self-healing of stale KubernetesCluster records.
- Fix #4: _inject_eks_bearer_token region priority (cluster.region over creds_env)
  and credential fallback to project_variables.variable_defaults / module variables.
- Fix #5: generate_forge_kubeconfig_local and write_provider_config fallback to
  project_variables.variable_defaults for aws_region and cluster_name.
"""

import base64
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import yaml

from core.encryption import decrypt_value, encrypt_value
from models import KubernetesCluster, ModuleLibrary, Project, ProjectModule, ProjectSecret
from services.eks_service import (
    generate_eks_kubeconfig,
    register_eks_cluster,
    unregister_eks_cluster,
)
from services.execution.config_writer import write_provider_config
from services.execution.engine_router import EngineRouter, _inject_eks_bearer_token
from services.execution.kubernetes_engine import KubernetesEngine
from services.execution.variable_assembler import build_variables
from services.secrets_service import SecretsService
from utils.provider_config import generate_forge_kubeconfig_local


def _create_eks_project_and_module(
    db,
    *,
    project_region=None,
    variable_defaults=None,
    module_name="eks-cluster-create",
    outputs=None,
):
    project = Project(
        name="eks-e2e-test-proj",
        cloud_provider="aws",
        region=project_region,
        project_variables={"variable_defaults": variable_defaults or {}},
    )
    db.add(project)
    db.flush()

    lib_mod = ModuleLibrary(
        name=module_name,
        category="infrastructure",
        provider="aws",
        execution_engine="opentofu",
        git_source="https://github.com/JLCode-tech/bnk-forge-catalog-aws-eks.git",
        version="2.4.1",
    )
    db.add(lib_mod)
    db.flush()

    proj_mod = ProjectModule(
        project_id=project.id,
        module_library_id=lib_mod.id,
        path_in_project="2-cluster",
        deployment_order=2,
        status="applied",
        outputs=outputs or {},
        variables={},
        variable_overrides={},
    )
    db.add(proj_mod)
    db.commit()
    db.refresh(project)
    db.refresh(proj_mod)
    return project, proj_mod, lib_mod


class TestFix3EksClusterRegistrationAndLifecycle:
    """Tests for Fix #3: EKS registration, upsert, pruning, unregistration, and self-heal."""

    def test_register_eks_cluster_extracts_region_from_eks_cluster_arn(self, db):
        outputs = {
            "cluster_name": {"value": "my-eks-west2"},
            "cluster_endpoint": {"value": "https://OLD.gr7.us-west-2.eks.amazonaws.com"},
            "cluster_certificate_authority_data": {"value": "LS0tLS1CRUdJTi..."},
            "eks_cluster_arn": {"value": "arn:aws:eks:us-west-2:123456789012:cluster/my-eks-west2"},
            "cluster_version": {"value": "1.31"},
        }
        project, proj_mod, _ = _create_eks_project_and_module(db, project_region=None, outputs=outputs)

        cluster = register_eks_cluster(db, proj_mod)
        assert cluster is not None
        assert cluster.region == "us-west-2"
        assert cluster.api_server == "https://OLD.gr7.us-west-2.eks.amazonaws.com"
        kc = yaml.safe_load(decrypt_value(cluster.kubeconfig_encrypted))
        user_exec_args = kc["users"][0]["user"]["exec"]["args"]
        assert user_exec_args[user_exec_args.index("--region") + 1] == "us-west-2"

    def test_register_eks_cluster_upserts_in_place_and_prunes_stale_rows(self, db):
        old_outputs = {
            "cluster_name": {"value": "colleague-eks"},
            "cluster_endpoint": {"value": "https://7F1B68B9C7CEB96AC3C5E571A09BA945.gr7.us-west-2.eks.amazonaws.com"},
            "cluster_certificate_authority_data": {"value": "Y2Etb2xk"},
            "eks_cluster_arn": {"value": "arn:aws:eks:us-west-2:111122223333:cluster/colleague-eks"},
        }
        project, proj_mod, _ = _create_eks_project_and_module(db, outputs=old_outputs)

        first_cluster = register_eks_cluster(db, proj_mod)
        assert first_cluster is not None
        first_id = first_cluster.id

        # Also insert a stale orphan auto-registered EKS row with an older name in the same project
        orphan_cluster = KubernetesCluster(
            name="stale-old-cluster",
            context="stale-old-cluster",
            project_id=project.id,
            cloud_provider="aws",
            region="us-east-1",
            api_server="https://STALE.gr7.us-east-1.eks.amazonaws.com",
            kubeconfig_encrypted=encrypt_value("stale"),
            status="active",
            meta_data={"auto_registered": True, "source_module_id": 999999},
        )
        db.add(orphan_cluster)
        db.commit()

        # Now re-apply the module with a brand new EKS control plane endpoint
        new_endpoint = "https://63AA4D5DC1198F363B1EEFF44AAECDF4.sk1.us-west-2.eks.amazonaws.com"
        proj_mod.outputs = {
            "cluster_name": {"value": "colleague-eks"},
            "cluster_endpoint": {"value": new_endpoint},
            "cluster_certificate_authority_data": {"value": "Y2EtbmV3"},
            "eks_cluster_arn": {"value": "arn:aws:eks:us-west-2:111122223333:cluster/colleague-eks"},
            "cluster_version": {"value": "1.32"},
        }
        db.commit()

        updated_cluster = register_eks_cluster(db, proj_mod)
        assert updated_cluster is not None
        assert updated_cluster.id == first_id
        assert updated_cluster.api_server == new_endpoint
        assert updated_cluster.region == "us-west-2"
        assert updated_cluster.version == "1.32"

        kc = yaml.safe_load(decrypt_value(updated_cluster.kubeconfig_encrypted))
        assert kc["clusters"][0]["cluster"]["server"] == new_endpoint
        assert kc["clusters"][0]["cluster"]["certificate-authority-data"] == "Y2EtbmV3"

        # Verify stale orphan row was pruned so only 1 active row remains for the project
        remaining = db.query(KubernetesCluster).filter(KubernetesCluster.project_id == project.id).all()
        assert len(remaining) == 1
        assert remaining[0].id == first_id

    def test_unregister_eks_cluster_matches_by_source_module_id_and_outputs(self, db):
        outputs = {
            "cluster_name": {"value": "destroy-me-eks"},
            "cluster_endpoint": {"value": "https://DESTROY.gr7.us-west-2.eks.amazonaws.com"},
            "cluster_certificate_authority_data": {"value": "Y2E="},
            "region": {"value": "us-west-2"},
        }
        project, proj_mod, _ = _create_eks_project_and_module(db, outputs=outputs)
        cluster = register_eks_cluster(db, proj_mod)
        assert cluster is not None

        # Simulate run_opentofu_destroy clearing module.outputs before calling unregister_eks_cluster
        prev_outputs = dict(proj_mod.outputs)
        proj_mod.outputs = None
        db.commit()

        removed = unregister_eks_cluster(db, proj_mod, outputs=prev_outputs)
        assert removed is True
        assert db.query(KubernetesCluster).filter(KubernetesCluster.project_id == project.id).count() == 0

    def test_engine_router_resolve_kubeconfig_self_heals_stale_cluster_row(self, db):
        new_endpoint = "https://63AA4D5DC1198F363B1EEFF44AAECDF4.sk1.us-west-2.eks.amazonaws.com"
        outputs = {
            "cluster_name": {"value": "healed-eks"},
            "cluster_endpoint": {"value": new_endpoint},
            "cluster_certificate_authority_data": {"value": "Y2EtaGVhbGVk"},
            "eks_cluster_arn": {"value": "arn:aws:eks:us-west-2:111122223333:cluster/healed-eks"},
        }
        project, proj_mod, _ = _create_eks_project_and_module(db, outputs=outputs)

        # Seed a stale KubernetesCluster pointing to an old destroyed endpoint
        stale = KubernetesCluster(
            name="healed-eks",
            context="healed-eks",
            project_id=project.id,
            cloud_provider="aws",
            region="us-east-1",
            api_server="https://7F1B68B9C7CEB96AC3C5E571A09BA945.gr7.us-west-2.eks.amazonaws.com",
            kubeconfig_encrypted=encrypt_value(
                generate_eks_kubeconfig(
                    cluster_name="healed-eks",
                    cluster_endpoint="https://7F1B68B9C7CEB96AC3C5E571A09BA945.gr7.us-west-2.eks.amazonaws.com",
                    cluster_ca_data="Y2Etb2xk",
                    region="us-east-1",
                )
            ),
            status="active",
            meta_data={"auto_registered": True, "source_module_id": proj_mod.id},
        )
        db.add(stale)
        db.commit()
        db.refresh(project)

        with patch(
            "services.execution.engine_router._inject_eks_bearer_token",
            side_effect=lambda kc, *a, **kw: kc,
        ):
            resolved_kc_path = EngineRouter.resolve_kubeconfig(project, db)

        assert resolved_kc_path is not None
        parsed = yaml.safe_load(Path(resolved_kc_path).read_text())
        assert parsed["clusters"][0]["cluster"]["server"] == new_endpoint

        db.refresh(stale)
        assert stale.api_server == new_endpoint
        assert stale.region == "us-west-2"


class TestFix4InjectEksBearerToken:
    """Tests for Fix #4: _inject_eks_bearer_token region priority & credential fallback."""

    def test_prioritizes_cluster_region_over_creds_env_and_falls_back_to_variable_defaults(self):
        raw_kc = generate_eks_kubeconfig(
            cluster_name="west2-eks",
            cluster_endpoint="https://63AA4D.sk1.us-west-2.eks.amazonaws.com",
            cluster_ca_data="Y2E=",
            region="us-west-2",
        )
        project = SimpleNamespace(
            id=1,
            name="west2-proj",
            region="us-east-1",
            project_variables={
                "variable_defaults": {
                    "aws_access_key_id": "AKIA_FROM_DEFAULTS",
                    "aws_secret_access_key": "SECRET_FROM_DEFAULTS",
                    "aws_region": "us-west-2",
                }
            },
            project_modules=[],
        )
        cluster = SimpleNamespace(
            name="west2-eks",
            context="west2-eks",
            region="us-west-2",
            cloud_provider="aws",
            meta_data={},
        )

        with patch(
            "services.credentials_service.get_cloud_credentials_env",
            return_value={"AWS_REGION": "us-east-1"},
        ):
            result_kc = _inject_eks_bearer_token(raw_kc, cluster, project, MagicMock())

        parsed = yaml.safe_load(result_kc)
        token = parsed["users"][0]["user"]["token"]
        assert token.startswith("k8s-aws-v1.")
        b64_part = token[len("k8s-aws-v1.") :]
        padded = b64_part + "=" * (-len(b64_part) % 4)
        signed_url = base64.urlsafe_b64decode(padded).decode("utf-8")
        assert "https://sts.us-west-2.amazonaws.com/" in signed_url
        assert "AKIA_FROM_DEFAULTS" in signed_url
        assert "us-west-2" in signed_url


class TestFix2PullSecretAndJwtTokenHandling:
    """Tests for Fix #2: file-secret fallback, raw JSON normalization, Helm login, and sibling fallback."""

    def test_prepare_secrets_for_execution_exposes_file_secrets_and_normalizes_json(self, db, tmp_path):
        project, _, _ = _create_eks_project_and_module(db)
        raw_docker_json = json.dumps({"auths": {"repo.f5.com": {"auth": base64.b64encode(b"u:p").decode()}}})
        secret_service = SecretsService(db)

        s_pull = ProjectSecret(
            project_id=project.id,
            name="cne_pull_secret",
            secret_type="file",
            target_variable_name="cne_pull_secret",
            file_content_encrypted=encrypt_value(base64.b64encode(raw_docker_json.encode("utf-8")).decode("utf-8")),
            filename="cne_pull_secret.json",
            is_active=True,
        )
        s_jwt = ProjectSecret(
            project_id=project.id,
            name="jwt_token",
            secret_type="file",
            target_variable_name="jwt_token",
            file_content_encrypted=encrypt_value(
                base64.b64encode(b"  eyJhbGciOiJSUzI1NiJ9.payload.sig \n").decode("utf-8")
            ),
            filename="jwt.txt",
            is_active=True,
        )
        db.add_all([s_pull, s_jwt])
        db.commit()

        value_secrets, _file_paths = secret_service.prepare_secrets_for_execution(project.id, str(tmp_path))

        assert "cne_pull_secret" in value_secrets
        # Should be base64-encoded so Helm's b64dec produces valid JSON
        decoded = base64.b64decode(value_secrets["cne_pull_secret"]).decode("utf-8")
        assert json.loads(decoded)["auths"]["repo.f5.com"] is not None

        assert value_secrets.get("jwt_token") == "eyJhbGciOiJSUzI1NiJ9.payload.sig"

    def test_helm_registry_login_accepts_raw_json_and_base64_docker_auths(self, tmp_path):
        kc_file = tmp_path / "kubeconfig.yaml"
        kc_file.write_text("apiVersion: v1\nkind: Config\n")
        engine = KubernetesEngine(kubeconfig_path=str(kc_file))
        raw_docker_json = json.dumps(
            {"auths": {"repo.f5.com": {"auth": base64.b64encode(b"robot-user:robot-token").decode()}}}
        )
        b64_docker_json = base64.b64encode(raw_docker_json.encode()).decode()

        for payload in (raw_docker_json, b64_docker_json):
            with patch("subprocess.run") as mock_run:
                mock_run.return_value = MagicMock(returncode=0, stderr="", stdout="")
                engine._helm_registry_login(
                    "repo.f5.com",
                    {"cne_pull_secret": payload},
                    {"PATH": "/usr/bin"},
                    None,
                )
                assert mock_run.called
                cmd = mock_run.call_args[0][0]
                assert cmd[:4] == ["helm", "registry", "login", "repo.f5.com"]
                assert "--username" in cmd
                assert cmd[cmd.index("--username") + 1] == "robot-user"

        raw_gcp_sa = json.dumps({"type": "service_account", "private_key": "-----BEGIN PRIVATE KEY-----\n..."})
        with patch("subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=0, stderr="", stdout="")
            engine._helm_registry_login(
                "repo.f5.com",
                {"cne_pull_secret": raw_gcp_sa},
                {"PATH": "/usr/bin"},
                None,
            )
            assert mock_run.called
            cmd = mock_run.call_args[0][0]
            assert cmd[:4] == ["helm", "registry", "login", "repo.f5.com"]
            assert cmd[cmd.index("--username") + 1] == "_json_key"

    def test_variable_assembler_recovers_cne_pull_secret_and_jwt_from_sibling_module(self, db):
        raw_docker_json = json.dumps({"auths": {"repo.f5.com": {"auth": base64.b64encode(b"u:p").decode()}}})
        project, _cluster_mod, _ = _create_eks_project_and_module(db)

        prereqs_lib = ModuleLibrary(
            name="eks-cluster-prereqs",
            category="kubernetes",
            provider="aws",
            execution_engine="kubernetes",
            git_source="https://github.com/JLCode-tech/bnk-forge-catalog-aws-eks.git",
            version="2.4.1",
        )
        flo_lib = ModuleLibrary(
            name="eks-cluster-install-flo",
            category="kubernetes",
            provider="aws",
            execution_engine="kubernetes",
            git_source="https://github.com/JLCode-tech/bnk-forge-catalog-aws-eks.git",
            version="2.4.1",
            variables_schema=[
                {"name": "version", "type": "string", "default": "0.8.8-0.1.27"},
                {"name": "jwt_token", "type": "string", "sensitive": True},
                {"name": "cne_pull_secret", "type": "string", "sensitive": True},
            ],
        )
        db.add_all([prereqs_lib, flo_lib])
        db.flush()

        prereqs_mod = ProjectModule(
            project_id=project.id,
            module_library_id=prereqs_lib.id,
            path_in_project="5-bnk-prereqs",
            deployment_order=5,
            status="applied",
            variables={},
            variable_overrides={
                "cne_pull_secret": raw_docker_json,
                "jwt_token": "eyJ sibling-jwt-token ",
            },
        )
        flo_mod = ProjectModule(
            project_id=project.id,
            module_library_id=flo_lib.id,
            path_in_project="6-flo",
            deployment_order=6,
            status="pending",
            variables={},
            variable_overrides={},
        )
        db.add_all([prereqs_mod, flo_mod])
        db.commit()
        db.refresh(project)
        db.refresh(flo_mod)

        assembled = build_variables(
            db=db,
            module=flo_mod,
            secret_variables={},
        )
        assert assembled.get("jwt_token") == "eyJ sibling-jwt-token"
        assert "cne_pull_secret" in assembled
        decoded = base64.b64decode(assembled["cne_pull_secret"]).decode("utf-8")
        assert json.loads(decoded)["auths"]["repo.f5.com"] is not None


class TestFix5VariableDefaultsFallback:
    """Tests for Fix #5: aws_region and cluster_name fallback from project_variables.variable_defaults."""

    def test_generate_forge_kubeconfig_local_falls_back_to_variable_defaults(self):
        project = SimpleNamespace(
            id=10,
            name="aws-eks-demo",
            cloud_provider="aws",
            region=None,
            project_variables={
                "variable_defaults": {
                    "aws_region": "us-west-2",
                    "cluster_name": "defaults-eks-cluster",
                }
            },
            project_modules=[],
        )
        hcl_str = generate_forge_kubeconfig_local(
            cloud_provider="aws",
            variables={},
            project=project,
        )
        assert hcl_str
        assert '"--cluster-name", "defaults-eks-cluster"' in hcl_str
        assert '"--region", "us-west-2"' in hcl_str

    def test_write_provider_config_falls_back_to_variable_defaults_aws_region(self, tmp_path):
        project = SimpleNamespace(
            id=11,
            name="aws-eks-demo",
            cloud_provider="aws",
            region=None,
            project_variables={
                "variable_defaults": {
                    "aws_region": "us-west-2",
                    "cluster_name": "defaults-eks-cluster",
                }
            },
            project_modules=[],
        )
        lib_mod = SimpleNamespace(
            name="eks-cluster-prereqs",
            cloud_provider="aws",
            inputs_metadata={"providers": {"required": ["kubernetes", "aws"]}},
            variables_schema=[],
        )
        module = SimpleNamespace(
            id=1,
            path_in_project="5-bnk-prereqs",
            project=project,
            library_module=lib_mod,
            variables={},
            variable_overrides={},
        )

        write_provider_config(
            work_dir=str(tmp_path),
            module=module,
            variables={},
        )
        provider_tf = (tmp_path / "bnk_forge_providers.tf").read_text()
        assert 'region = "us-west-2"' in provider_tf
        assert 'name = "defaults-eks-cluster"' in provider_tf


class TestSkepticalReviewRegressions:
    """Regression tests for the 5 backend edge cases uncovered during skeptical review."""

    def test_opentofu_get_global_tfvar_env_supports_file_secret_and_json_wrapper(self, db):
        from services.execution.opentofu_engine import OpenTofuEngine

        project, _, _ = _create_eks_project_and_module(db)
        wrapped_jwt = json.dumps({"jwt_token": "  eyJhbGciOiJSUzI1NiJ9.file.sig \n"})
        s_jwt = ProjectSecret(
            project_id=project.id,
            name="f5-license-file",
            secret_type="file",
            target_variable_name="jwt_token",
            file_content_encrypted=encrypt_value(base64.b64encode(wrapped_jwt.encode("utf-8")).decode("utf-8")),
            filename="jwt.json",
            is_active=True,
        )
        db.add(s_jwt)
        db.commit()

        env = OpenTofuEngine(lambda: db)._get_global_tfvar_env(project, db)
        assert env == {"TF_VAR_jwt_token": "eyJhbGciOiJSUzI1NiJ9.file.sig"}

    def test_prepare_secrets_shares_bnk_secrets_across_modules_and_layer6b_queries_db(self, db, tmp_path):
        project, _, _ = _create_eks_project_and_module(db)
        raw_docker_json = json.dumps({"auths": {"repo.f5.com": {"auth": base64.b64encode(b"u:p").decode()}}})
        s_pull = ProjectSecret(
            project_id=project.id,
            name="cne_pull_secret",
            secret_type="file",
            target_module_path="modules/eks-cluster-install-bnk-prereqs",
            target_variable_name="cne_pull_secret",
            file_content_encrypted=encrypt_value(base64.b64encode(raw_docker_json.encode("utf-8")).decode("utf-8")),
            filename="cne_pull_secret.json",
            is_active=True,
        )
        s_jwt = ProjectSecret(
            project_id=project.id,
            name="jwt_token",
            secret_type="value",
            target_module_path="modules/eks-cluster-install-bnk-prereqs",
            target_variable_name="jwt_token",
            value_encrypted=encrypt_value('{"jwt": "eyJhbGciOiJSUzI1NiJ9.db.sig"}'),
            is_active=True,
        )
        db.add_all([s_pull, s_jwt])
        db.commit()

        # 1. prepare_secrets_for_execution for flo must still include cne_pull_secret & jwt_token
        svc = SecretsService(db)
        val_secrets, _ = svc.prepare_secrets_for_execution(
            project.id, str(tmp_path), module_path="modules/eks-cluster-install-flo"
        )
        assert "cne_pull_secret" in val_secrets
        assert val_secrets.get("jwt_token") == "eyJhbGciOiJSUzI1NiJ9.db.sig"

        # 2. build_variables called without secret_variables (e.g. workspace_manager) recovers from DB
        flo_lib = ModuleLibrary(
            name="eks-cluster-install-flo-db",
            category="kubernetes",
            provider="aws",
            execution_engine="kubernetes",
            git_source="https://github.com/JLCode-tech/bnk-forge-catalog-aws-eks.git",
            version="2.4.1",
            variables_schema=[
                {"name": "jwt_token", "type": "string", "sensitive": True},
                {"name": "cne_pull_secret", "type": "string", "sensitive": True},
            ],
        )
        db.add(flo_lib)
        db.flush()
        flo_mod = ProjectModule(
            project_id=project.id,
            module_library_id=flo_lib.id,
            path_in_project="6-flo",
            deployment_order=6,
            status="pending",
            variables={},
            variable_overrides={},
        )
        db.add(flo_mod)
        db.commit()
        db.refresh(flo_mod)

        assembled = build_variables(db=db, module=flo_mod, secret_variables=None)
        assert assembled.get("jwt_token") == "eyJhbGciOiJSUzI1NiJ9.db.sig"
        decoded_pull = base64.b64decode(assembled["cne_pull_secret"]).decode("utf-8")
        assert json.loads(decoded_pull)["auths"]["repo.f5.com"] is not None

    def test_get_cloud_credentials_env_never_sets_none_and_falls_back_to_variable_defaults(self, db):
        from models import CloudCredentialTemplate
        from services.credentials_service import get_cloud_credentials_env

        sso_tmpl = CloudCredentialTemplate(
            name="unexchanged-aws-sso",
            provider="aws",
            aws_auth_method="sso",
            aws_access_key_id=None,
            region=None,
        )
        db.add(sso_tmpl)
        db.flush()

        project = Project(
            name="wizard-creds-proj",
            cloud_provider="aws",
            region=None,
            credential_template_id=sso_tmpl.id,
            project_variables={
                "variable_defaults": {
                    "aws_access_key_id": "AKIA_WIZARD_KEY",
                    "aws_secret_access_key": "SECRET_WIZARD_KEY",
                    "aws_session_token": "SESSION_WIZARD_TOK",
                    "aws_region": "us-west-2",
                }
            },
        )
        db.add(project)
        db.commit()
        db.refresh(project)

        env = get_cloud_credentials_env(project, db, strict=False)
        assert all(v is not None for v in env.values())
        assert env.get("AWS_ACCESS_KEY_ID") == "AKIA_WIZARD_KEY"
        assert env.get("AWS_SECRET_ACCESS_KEY") == "SECRET_WIZARD_KEY"
        assert env.get("AWS_SESSION_TOKEN") == "SESSION_WIZARD_TOK"
        assert env.get("AWS_DEFAULT_REGION") == "us-west-2"
        assert env.get("TF_VAR_aws_access_key_id") == "AKIA_WIZARD_KEY"
        assert env.get("TF_VAR_aws_region") == "us-west-2"

    def test_register_eks_cluster_supports_eks_cluster_version_oidc_issuer_and_cluster_id(self, db):
        from services.eks_service import matches_eks_output_contract

        outputs = {
            "cluster_name": {"value": "contract-eks"},
            "cluster_endpoint": {"value": "https://CONTRACT.gr7.us-west-2.eks.amazonaws.com"},
            "cluster_certificate_authority_data": {"value": "Y2E="},
            "cluster_id": {"value": "arn:aws:eks:us-west-2:123456789012:cluster/contract-eks"},
            "eks_cluster_version": {"value": "1.32"},
            "cluster_oidc_issuer_url": {"value": "https://oidc.eks.us-west-2.amazonaws.com/id/ABC123"},
        }
        assert matches_eks_output_contract(outputs) is True
        _, proj_mod, _ = _create_eks_project_and_module(db, project_region=None, outputs=outputs)
        cluster = register_eks_cluster(db, proj_mod)
        assert cluster.version == "1.32"
        assert cluster.region == "us-west-2"
        assert cluster.meta_data["oidc_provider_url"] == "https://oidc.eks.us-west-2.amazonaws.com/id/ABC123"
        assert cluster.meta_data["cluster_arn"] == "arn:aws:eks:us-west-2:123456789012:cluster/contract-eks"

    def test_resolve_active_project_cluster_queries_db_modules_and_sorts_by_updated_at(self, db):
        from datetime import UTC, datetime, timedelta

        from services.execution.engine_router import _resolve_active_project_cluster

        project = Project(name="cluster-sort-proj", cloud_provider="aws", region="us-west-2")
        db.add(project)
        db.flush()

        now = datetime.now(UTC)
        older_id_newer_update = KubernetesCluster(
            name="cluster-updated-recently",
            context="cluster-updated-recently",
            project_id=project.id,
            cloud_provider="aws",
            region="us-west-2",
            api_server="https://NEWER-UPDATE.eks.amazonaws.com",
            kubeconfig_encrypted=encrypt_value("kc1"),
            status="active",
            updated_at=now + timedelta(minutes=5),
        )
        newer_id_older_update = KubernetesCluster(
            name="cluster-older-update",
            context="cluster-older-update",
            project_id=project.id,
            cloud_provider="aws",
            region="us-west-2",
            api_server="https://OLDER-UPDATE.eks.amazonaws.com",
            kubeconfig_encrypted=encrypt_value("kc2"),
            status="active",
            updated_at=now - timedelta(minutes=5),
        )
        db.add_all([older_id_newer_update, newer_id_older_update])
        db.commit()

        # Pass a lightweight project namespace without project_modules loaded
        project_shim = SimpleNamespace(id=project.id, project_modules=None)
        chosen = _resolve_active_project_cluster(project_shim, db)
        assert chosen is not None
        assert chosen.name == "cluster-updated-recently"
