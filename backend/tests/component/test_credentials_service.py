"""
BC-028: Component tests for credentials_service — credential loading priority,
template-based credentials, legacy credentials, environment fallback.

Uses real SQLite DB with mocked encryption.
"""

import json
from unittest.mock import MagicMock, patch

import pytest

from models import ApplicationSetting, CloudCredentialTemplate, Project
from services.credentials_service import (
    CredentialUnavailableError,
    _decrypt_credential,
    get_azure_service_principal_info,
    get_cloud_credentials_env,
    get_cloud_credentials_only,
    get_gcp_service_account_info,
)

# ── Helpers ──────────────────────────────────────────────────────────


def _make_project(db, name="Cred Project", credential_template_id=None, **kwargs):
    project_type = kwargs.pop("project_type", "cloud-aws")
    cloud_provider = kwargs.pop("cloud_provider", "aws")
    project = Project(
        name=name,
        project_type=project_type,
        cloud_provider=cloud_provider,
        environment="dev",
        backend_type="local",
        color="#000",
        icon="cloud",
        is_active=True,
        credential_template_id=credential_template_id,
        **kwargs,
    )
    db.add(project)
    db.flush()
    return project


def _make_template(db, **kwargs):
    defaults = dict(
        name="AWS Template",
        provider="aws",
        region="us-east-1",
        aws_auth_method="access_keys",
        aws_access_key_id="AKIA_TEMPLATE",
        aws_secret_access_key_encrypted="enc_secret",
    )
    defaults.update(kwargs)
    template = CloudCredentialTemplate(**defaults)
    db.add(template)
    db.flush()
    return template


def _make_app_setting(db, key, value, is_encrypted=False):
    setting = ApplicationSetting(key=key, value=value, is_encrypted=is_encrypted)
    db.add(setting)
    db.flush()
    return setting


# ── _decrypt_credential helper ───────────────────────────────────────


class TestDecryptCredentialHelper:
    def test_returns_none_for_empty(self):
        result = _decrypt_credential(None, "test_field")
        assert result is None

    def test_returns_none_for_empty_string(self):
        result = _decrypt_credential("", "test_field")
        assert result is None

    @patch("services.credentials_service.decrypt_value", return_value="decrypted")
    def test_decrypts_value(self, mock_dec):
        result = _decrypt_credential("encrypted_data", "test_field")
        assert result == "decrypted"

    @patch("services.credentials_service.decrypt_value", side_effect=Exception("Bad key"))
    def test_returns_none_on_error(self, mock_dec):
        result = _decrypt_credential("bad_data", "test_field")
        assert result is None


# ── Priority 1: Credential Template ─────────────────────────────────


class TestCredentialTemplate:
    @patch("services.credentials_service.decrypt_value", return_value="template_secret")
    def test_access_keys_template(self, mock_dec, db):
        template = _make_template(db)
        project = _make_project(db, credential_template_id=template.id)

        env = get_cloud_credentials_env(project, db=db)

        assert env["AWS_ACCESS_KEY_ID"] == "AKIA_TEMPLATE"
        assert env["AWS_SECRET_ACCESS_KEY"] == "template_secret"
        assert env["AWS_DEFAULT_REGION"] == "us-east-1"

    @patch("services.credentials_service.decrypt_value", return_value="decrypted")
    def test_profile_template(self, mock_dec, db):
        template = _make_template(
            db,
            aws_auth_method="profile",
            aws_profile="prod-profile",
            aws_access_key_id=None,
            aws_secret_access_key_encrypted=None,
        )
        project = _make_project(db, credential_template_id=template.id)

        env = get_cloud_credentials_env(project, db=db)
        assert env["AWS_PROFILE"] == "prod-profile"

    @patch("services.credentials_service.decrypt_value", return_value="ibm-api-key")
    def test_ibm_template(self, mock_dec, db):
        template = _make_template(
            db,
            name="IBM Template",
            provider="ibm",
            region="us-south",
            aws_auth_method=None,
            aws_access_key_id=None,
            aws_secret_access_key_encrypted=None,
            ibmcloud_api_key_encrypted="enc_ibm_key",
        )
        project = _make_project(
            db,
            credential_template_id=template.id,
            project_type="cloud-aws",
            cloud_provider="ibm",
        )

        env = get_cloud_credentials_env(project, db=db)

        assert env["IC_API_KEY"] == "ibm-api-key"
        assert env["IBMCLOUD_API_KEY"] == "ibm-api-key"
        assert env["IBMCLOUD_REGION"] == "us-south"

    @patch("services.credentials_service.decrypt_value", return_value="ibm-api-key")
    def test_misspelled_ibmcloud_provider_injects_nothing(self, mock_dec, db):
        """Issue #191 reproduction at the injection layer.

        A template stored with provider='ibmcloud' (the natural misspelling of
        the canonical 'ibm', matching every adjacent ibmcloud_* field name)
        matches NO branch in the resolver, so it silently contributes no IBM
        credentials — the deploy then fails far away with a BearerToken error.
        The create/update validation (issue #191) now prevents such a row from
        being created; this locks the resolver contract that made it dangerous.
        """
        template = _make_template(
            db,
            name="IBM ROKs Testing",
            provider="ibmcloud",  # unknown to the resolver -> no-op
            region="us-east",
            aws_auth_method=None,
            aws_access_key_id=None,
            aws_secret_access_key_encrypted=None,
            ibmcloud_api_key_encrypted="enc_ibm_key",
        )
        project = _make_project(
            db,
            credential_template_id=template.id,
            project_type="cloud-aws",
            cloud_provider="ibm",
        )

        env = get_cloud_credentials_env(project, db=db)

        # The stored API key never reaches the deployment environment.
        assert "IC_API_KEY" not in env
        assert "IBMCLOUD_API_KEY" not in env

    @patch("services.credentials_service.decrypt_value", side_effect=Exception("Bad key"))
    def test_ibm_template_decrypt_failure_omits_api_key(self, mock_dec, db):
        template = _make_template(
            db,
            name="IBM Template Bad Key",
            provider="ibm",
            region="eu-de",
            aws_auth_method=None,
            aws_access_key_id=None,
            aws_secret_access_key_encrypted=None,
            ibmcloud_api_key_encrypted="enc_ibm_key",
        )
        project = _make_project(
            db,
            credential_template_id=template.id,
            project_type="cloud-aws",
            cloud_provider="ibm",
        )

        env = get_cloud_credentials_env(project, db=db)

        assert "IC_API_KEY" not in env
        assert "IBMCLOUD_API_KEY" not in env
        assert env["IBMCLOUD_REGION"] == "eu-de"

    @pytest.mark.parametrize("method, exported", [("service_principal", True), ("sso", False)])
    @patch("services.credentials_service.decrypt_value", return_value="sp-secret")
    def test_azure_template_exports_client_secret_only_for_service_principal(
        self, mock_dec, method, exported, db, monkeypatch
    ):
        for key in ("ARM_CLIENT_ID", "ARM_CLIENT_SECRET", "AZURE_CLIENT_ID", "AZURE_CLIENT_SECRET"):
            monkeypatch.delenv(key, raising=False)
        template = _make_template(
            db,
            name="Azure Template",
            provider="azure",
            region="eastus",
            aws_auth_method=None,
            aws_access_key_id=None,
            aws_secret_access_key_encrypted=None,
            azure_auth_method=method,
            azure_tenant_id="tenant-1",
            azure_subscription_id="sub-1",
            azure_client_id="client-1",
            azure_client_secret_encrypted="enc",
        )
        project = _make_project(
            db, credential_template_id=template.id, project_type="cloud-azure", cloud_provider="azure"
        )

        env = get_cloud_credentials_env(project, db=db)

        assert env["ARM_TENANT_ID"] == "tenant-1"
        assert env["ARM_SUBSCRIPTION_ID"] == "sub-1"
        assert ("ARM_CLIENT_SECRET" in env) is exported
        assert ("ARM_CLIENT_ID" in env) is exported


# ── Priority 2: Legacy Encrypted Credentials ────────────────────────


class TestLegacyCredentials:
    @patch("services.credentials_service.decrypt_value")
    def test_legacy_access_key_credentials(self, mock_dec, db):
        cred_data = json.dumps(
            {
                "access_key_id": "AKIA_LEGACY",
                "secret_access_key": "legacy_secret",
            }
        )
        mock_dec.return_value = cred_data

        project = _make_project(
            db,
            cloud_credentials_encrypted="encrypted_json",
        )

        env = get_cloud_credentials_env(project, db=db)
        assert env["AWS_ACCESS_KEY_ID"] == "AKIA_LEGACY"
        assert env["AWS_SECRET_ACCESS_KEY"] == "legacy_secret"

    @patch("services.credentials_service.decrypt_value")
    def test_legacy_profile_credentials(self, mock_dec, db):
        cred_data = json.dumps(
            {
                "profile": "my-profile",
                "region": "eu-west-1",
            }
        )
        mock_dec.return_value = cred_data

        project = _make_project(
            db,
            cloud_credentials_encrypted="encrypted_json",
        )

        env = get_cloud_credentials_env(project, db=db)
        assert env["AWS_PROFILE"] == "my-profile"
        assert env["AWS_DEFAULT_REGION"] == "eu-west-1"


# ── Priority 3: Global Settings from DB ──────────────────────────────


class TestGlobalSettings:
    @patch("services.credentials_service.decrypt_value_or_none", return_value="global_secret")
    def test_global_credentials(self, mock_dec, db):
        _make_app_setting(db, "aws.access_key_id", "AKIA_GLOBAL")
        _make_app_setting(db, "aws.secret_access_key", "enc_global_secret", is_encrypted=True)
        _make_app_setting(db, "aws.region", "ap-southeast-1")

        project = _make_project(db)
        env = get_cloud_credentials_env(project, db=db)

        assert env["AWS_ACCESS_KEY_ID"] == "AKIA_GLOBAL"
        assert env["AWS_SECRET_ACCESS_KEY"] == "global_secret"
        assert env["AWS_DEFAULT_REGION"] == "ap-southeast-1"


# ── Fallback: Environment Variables ──────────────────────────────────


class TestEnvironmentFallback:
    @patch.dict("os.environ", {"AWS_ACCESS_KEY_ID": "AKIA_ENV", "AWS_SECRET_ACCESS_KEY": "env_secret"})
    def test_env_fallback(self, db):
        project = _make_project(db, region="us-west-2")

        env = get_cloud_credentials_env(project, db=db)
        assert env["AWS_ACCESS_KEY_ID"] == "AKIA_ENV"
        assert env["AWS_DEFAULT_REGION"] == "us-west-2"


# ── GCP service-account info helper ──────────────────────────────────


class TestGcpServiceAccountInfo:
    def _make_gcp_template(self, db, encrypted_value="enc_sa_json"):
        template = CloudCredentialTemplate(
            name="GCP Template",
            provider="gcp",
            gcp_project_id="my-gcp-project",
            gcp_credentials_encrypted=encrypted_value,
        )
        db.add(template)
        db.flush()
        return template

    def test_returns_none_when_no_template_attached(self, db):
        project = _make_project(db, name="No Template")
        assert get_gcp_service_account_info(project, db=db) is None

    def test_returns_none_when_db_missing(self, db):
        template = self._make_gcp_template(db)
        project = _make_project(db, name="No DB", credential_template_id=template.id)
        assert get_gcp_service_account_info(project, db=None) is None

    def test_returns_none_for_non_gcp_provider(self, db):
        template = _make_template(db)  # AWS
        project = _make_project(db, name="AWS Project", credential_template_id=template.id)
        assert get_gcp_service_account_info(project, db=db) is None

    def test_returns_none_when_credentials_missing(self, db):
        template = self._make_gcp_template(db, encrypted_value=None)
        project = _make_project(db, name="No Creds", credential_template_id=template.id)
        assert get_gcp_service_account_info(project, db=db) is None

    @patch("services.credentials_service.decrypt_value", return_value=None)
    def test_returns_none_when_decryption_fails(self, mock_dec, db):
        template = self._make_gcp_template(db)
        project = _make_project(db, name="Bad Decrypt", credential_template_id=template.id)
        assert get_gcp_service_account_info(project, db=db) is None

    @patch("services.credentials_service.decrypt_value", return_value="not valid json {")
    def test_returns_none_for_invalid_json(self, mock_dec, db):
        template = self._make_gcp_template(db)
        project = _make_project(db, name="Bad JSON", credential_template_id=template.id)
        assert get_gcp_service_account_info(project, db=db) is None

    @patch("services.credentials_service.decrypt_value")
    def test_returns_parsed_sa_dict(self, mock_dec, db):
        sa_payload = {
            "type": "service_account",
            "project_id": "my-gcp-project",
            "private_key_id": "abc123",
            "client_email": "svc@my-gcp-project.iam.gserviceaccount.com",
        }
        mock_dec.return_value = json.dumps(sa_payload)

        template = self._make_gcp_template(db)
        project = _make_project(db, name="Good GCP", credential_template_id=template.id)
        result = get_gcp_service_account_info(project, db=db)

        assert result == sa_payload


# ── is_default fallback (Priority 2.5) ───────────────────────────────


class TestDefaultTemplateFallback:
    """
    When a project has no explicit credential_template_id and no project creds,
    the resolver must fall back to the is_default CloudCredentialTemplate.
    """

    @patch("services.credentials_service.decrypt_value", return_value="fallback_secret")
    def test_unbound_project_uses_default_template(self, mock_dec, db):
        """Project 40 shape: no credential_template_id, no project creds.
        Should transparently use the is_default template's AWS keys.
        """
        template = _make_template(db, is_default=True, aws_access_key_id="AKIA_DEFAULT")
        project = _make_project(db, name="Unbound Project")  # no template, no creds

        env = get_cloud_credentials_env(project, db=db)

        assert env["AWS_ACCESS_KEY_ID"] == "AKIA_DEFAULT"
        assert env["AWS_SECRET_ACCESS_KEY"] == "fallback_secret"

    def test_no_default_template_falls_through_gracefully(self, db):
        """If no is_default template exists, resolver should not fail — just
        return the global/env fallback as before.
        """
        project = _make_project(db, name="No Default")
        # No template with is_default=True in the DB
        env = get_cloud_credentials_env(project, db=db)
        # Should return something (env copy), not raise
        assert isinstance(env, dict)

    @patch("services.credentials_service.decrypt_value", return_value="bound_secret")
    def test_explicit_template_takes_precedence_over_default(self, mock_dec, db):
        """If the project has its own credential_template_id, the default template
        must NOT be consulted — explicit binding wins.
        """
        _make_template(db, name="Default Template", is_default=True, aws_access_key_id="AKIA_DEFAULT")
        explicit = _make_template(db, name="Explicit Template", is_default=False, aws_access_key_id="AKIA_EXPLICIT")
        project = _make_project(db, name="Explicitly Bound", credential_template_id=explicit.id)

        env = get_cloud_credentials_env(project, db=db)

        assert env["AWS_ACCESS_KEY_ID"] == "AKIA_EXPLICIT"

    def test_wrong_provider_default_not_used_for_aws_project(self, db):
        """An AWS project must NOT fall back to a GCP is_default template.

        A GCP default injecting credentials into an AWS project would cause a
        401 with no actionable error message.
        """
        # Only a GCP is_default template exists — no AWS default
        gcp_default = CloudCredentialTemplate(
            name="GCP Default",
            provider="gcp",
            is_default=True,
        )
        db.add(gcp_default)
        db.flush()

        project = _make_project(db, name="AWS No Fallback", cloud_provider="aws")
        # project has no credential_template_id and no project creds

        env = get_cloud_credentials_env(project, db=db)

        # The GCP keys must not be present — wrong-provider fallback must not fire
        assert "AWS_ACCESS_KEY_ID" not in env or env.get("AWS_ACCESS_KEY_ID") != "GCP_KEY"
        # Specifically confirm we did NOT inject keys from the GCP template
        # (GCP template has no aws_access_key_id, but verifying no KeyError / wrong key)
        assert "IC_API_KEY" not in env
        assert "GOOGLE_APPLICATION_CREDENTIALS" not in env


# ── SSO CredentialUnavailableError ────────────────────────────────────


class TestSsoCredentialUnavailableError:
    """
    When an SSO template has absent or expired exchanged SigV4 keys:
    - strict=True (connectivity path) → CredentialUnavailableError
    - strict=False (default, ~19 task/deploy callers) → returns env, does NOT raise
    """

    def test_raises_when_sso_keys_absent_strict(self, db):
        """strict=True + aws_access_key_id is None → CredentialUnavailableError."""
        template = _make_template(
            db,
            name="SSO No Keys",
            aws_auth_method="sso",
            aws_sso_enabled=True,
            aws_access_key_id=None,
            aws_secret_access_key_encrypted=None,
        )
        project = _make_project(db, name="SSO Absent", credential_template_id=template.id)

        with pytest.raises(CredentialUnavailableError, match="not been exchanged"):
            get_cloud_credentials_env(project, db=db, strict=True)

    def test_raises_when_sso_keys_expired_strict(self, db):
        """strict=True + aws_credentials_expiry in the past → CredentialUnavailableError."""
        from datetime import UTC, datetime, timedelta

        past = datetime.now(UTC) - timedelta(hours=1)
        template = _make_template(
            db,
            name="SSO Expired",
            aws_auth_method="sso",
            aws_sso_enabled=True,
            aws_access_key_id="AKIA_EXPIRED",
            aws_secret_access_key_encrypted="enc",
            aws_credentials_expiry=past,
        )
        project = _make_project(db, name="SSO Expired Project", credential_template_id=template.id)

        with pytest.raises(CredentialUnavailableError, match="expired"):
            get_cloud_credentials_env(project, db=db, strict=True)

    def test_absent_sso_keys_no_raise_when_not_strict(self, db):
        """strict=False (default) + absent SSO keys → returns env dict, does NOT raise.
        This is the regression guard for the ~19 task/deploy callers that must
        retain their existing graceful-degradation behaviour unchanged.
        """
        template = _make_template(
            db,
            name="SSO No Keys NonStrict",
            aws_auth_method="sso",
            aws_sso_enabled=True,
            aws_access_key_id=None,
            aws_secret_access_key_encrypted=None,
        )
        project = _make_project(db, name="SSO Absent NonStrict", credential_template_id=template.id)

        # Must NOT raise — should return a dict (may lack AWS keys, but no exception)
        env = get_cloud_credentials_env(project, db=db)
        assert isinstance(env, dict)

    def test_expired_sso_keys_no_raise_when_not_strict(self, db):
        """strict=False (default) + expired SSO keys → returns env dict, does NOT raise.
        Regression guard: task/deploy callers must not be broken by an expired template.
        """
        from datetime import UTC, datetime, timedelta

        past = datetime.now(UTC) - timedelta(hours=1)
        template = _make_template(
            db,
            name="SSO Expired NonStrict",
            aws_auth_method="sso",
            aws_sso_enabled=True,
            aws_access_key_id="AKIA_EXPIRED",
            aws_secret_access_key_encrypted="enc",
            aws_credentials_expiry=past,
        )
        project = _make_project(db, name="SSO Expired NonStrict Project", credential_template_id=template.id)

        # Must NOT raise — graceful degradation for task callers
        env = get_cloud_credentials_env(project, db=db)
        assert isinstance(env, dict)

    @patch("services.credentials_service.decrypt_value", return_value="sso_secret")
    def test_valid_sso_keys_do_not_raise(self, mock_dec, db):
        """SSO keys present and not expired → returns env without raising (both modes)."""
        from datetime import UTC, datetime, timedelta

        future = datetime.now(UTC) + timedelta(hours=1)
        template = _make_template(
            db,
            name="SSO Valid",
            aws_auth_method="sso",
            aws_sso_enabled=True,
            aws_access_key_id="AKIA_VALID",
            aws_secret_access_key_encrypted="enc",
            aws_credentials_expiry=future,
        )
        project = _make_project(db, name="SSO Valid Project", credential_template_id=template.id)

        env = get_cloud_credentials_env(project, db=db)
        assert env["AWS_ACCESS_KEY_ID"] == "AKIA_VALID"
        assert env["AWS_SECRET_ACCESS_KEY"] == "sso_secret"


# ── TF_VAR mirroring for AWS credential templates ────────────────────


class TestAwsTfVarMirroring:
    """
    BC-TFV: get_cloud_credentials_env must mirror resolved AWS credentials as
    TF_VAR_* so that Terraform modules using var.aws_access_key_id / var.aws_region
    in provider blocks receive the credentials without Forge persisting them in
    project variable storage.
    """

    @patch("services.credentials_service.decrypt_value", return_value="secret_value")
    def test_access_keys_template_mirrors_tf_vars(self, mock_dec, db):
        """access_keys auth → TF_VAR_aws_access_key_id / TF_VAR_aws_secret_access_key set."""
        template = _make_template(
            db,
            aws_access_key_id="AKIA_TF",
            aws_secret_access_key_encrypted="enc_secret",
            region="eu-west-1",
        )
        project = _make_project(db, credential_template_id=template.id)

        env = get_cloud_credentials_env(project, db=db)

        assert env["TF_VAR_aws_access_key_id"] == "AKIA_TF"
        assert env["TF_VAR_aws_secret_access_key"] == "secret_value"
        assert env["TF_VAR_aws_region"] == "eu-west-1"
        # TF_VAR mirrors equal the corresponding AWS_* values
        assert env["TF_VAR_aws_access_key_id"] == env["AWS_ACCESS_KEY_ID"]
        assert env["TF_VAR_aws_secret_access_key"] == env["AWS_SECRET_ACCESS_KEY"]
        assert env["TF_VAR_aws_region"] == env["AWS_DEFAULT_REGION"]

    @patch("services.credentials_service.decrypt_value", return_value="sso_secret_tf")
    def test_sso_template_mirrors_tf_vars(self, mock_dec, db):
        """SSO auth (keys present) → TF_VAR mirrors are set."""
        from datetime import UTC, datetime, timedelta

        future = datetime.now(UTC) + timedelta(hours=1)
        template = _make_template(
            db,
            name="SSO TF",
            aws_auth_method="sso",
            aws_sso_enabled=True,
            aws_access_key_id="AKIA_SSO",
            aws_secret_access_key_encrypted="enc",
            aws_credentials_expiry=future,
            region="ap-southeast-1",
        )
        project = _make_project(db, credential_template_id=template.id)

        env = get_cloud_credentials_env(project, db=db)

        assert env["TF_VAR_aws_access_key_id"] == "AKIA_SSO"
        assert env["TF_VAR_aws_secret_access_key"] == "sso_secret_tf"
        assert env["TF_VAR_aws_region"] == "ap-southeast-1"

    @patch("services.credentials_service.decrypt_value", return_value="tok_secret")
    def test_session_token_mirrored_when_present(self, mock_dec, db):
        """When AWS_SESSION_TOKEN is set, TF_VAR_aws_session_token must match."""
        template = _make_template(
            db,
            name="Keys With Token",
            aws_access_key_id="AKIA_TOK",
            aws_secret_access_key_encrypted="enc",
            region="us-east-1",
        )
        # Store a session token on the template to trigger token mirroring.
        template.aws_session_token_encrypted = "enc_tok"
        db.flush()
        project = _make_project(db, credential_template_id=template.id)

        env = get_cloud_credentials_env(project, db=db)

        assert env.get("TF_VAR_aws_session_token") == env.get("AWS_SESSION_TOKEN")

    @patch("services.credentials_service.decrypt_value", return_value="prof_secret")
    def test_profile_template_does_not_set_key_tf_vars(self, mock_dec, db):
        """Profile auth does not resolve individual keys → TF_VAR key vars must NOT be set."""
        template = _make_template(
            db,
            name="Profile Only",
            aws_auth_method="profile",
            aws_profile="my-profile",
            aws_access_key_id=None,
            aws_secret_access_key_encrypted=None,
            region="us-west-2",
        )
        project = _make_project(db, credential_template_id=template.id)

        env = get_cloud_credentials_env(project, db=db)

        # Profile auth sets AWS_PROFILE, not access keys
        assert env.get("AWS_PROFILE") == "my-profile"
        # No individual key TF_VARs — nothing to mirror
        assert "TF_VAR_aws_access_key_id" not in env
        assert "TF_VAR_aws_secret_access_key" not in env

    @patch("services.credentials_service.decrypt_value", return_value="ibm_secret")
    def test_ibm_template_does_not_set_aws_tf_vars(self, mock_dec, db):
        """IBM templates must not accidentally set AWS TF_VAR keys."""
        template = _make_template(
            db,
            name="IBM No TF",
            provider="ibm",
            region="us-south",
            aws_auth_method=None,
            aws_access_key_id=None,
            aws_secret_access_key_encrypted=None,
            ibmcloud_api_key_encrypted="enc_ibm",
        )
        project = _make_project(
            db,
            credential_template_id=template.id,
            project_type="cloud-ibm",
            cloud_provider="ibm",
        )

        env = get_cloud_credentials_env(project, db=db)

        assert "TF_VAR_aws_access_key_id" not in env
        assert "TF_VAR_aws_secret_access_key" not in env


class TestAzureSSOTemplateNotProvisioning:
    def _sso_template(self, db, **kwargs):
        return _make_template(
            db,
            name="Azure SSO",
            provider="azure",
            aws_auth_method=None,
            aws_access_key_id=None,
            aws_secret_access_key_encrypted=None,
            azure_auth_method="sso",
            azure_tenant_id="tenant-1",
            **kwargs,
        )

    def test_sso_default_template_not_used_for_unbound_azure_project(self, db, monkeypatch):
        monkeypatch.delenv("ARM_TENANT_ID", raising=False)
        self._sso_template(db, is_default=True)
        project = _make_project(db, name="Unbound Azure", project_type="cloud-azure", cloud_provider="azure")

        env = get_cloud_credentials_env(project, db=db)

        assert "ARM_TENANT_ID" not in env

    @patch("services.credentials_service.decrypt_value", return_value='{"client_id": "c", "client_secret": "s"}')
    def test_sp_resolver_ignores_sso_template_blob(self, mock_dec, db):
        template = self._sso_template(db, azure_credentials_encrypted="enc")
        project = _make_project(
            db,
            name="Azure SSO Bound",
            project_type="cloud-azure",
            cloud_provider="azure",
            credential_template_id=template.id,
        )

        assert get_azure_service_principal_info(project, db) is None


class TestAWSProfileSSOResolution:
    """Verify AWS CLI/SSO profile credentials resolve to frozen credentials and TF_VAR_aws_*."""

    def test_profile_resolves_frozen_credentials_and_tf_vars(self, db):
        template = _make_template(
            db,
            name="AWS SSO Profile",
            aws_auth_method="profile",
            aws_profile="Users-292785712872",
            aws_access_key_id=None,
            aws_secret_access_key_encrypted=None,
            region="ap-southeast-2",
        )
        project = _make_project(db, credential_template_id=template.id)

        mock_frozen = MagicMock()
        mock_frozen.access_key = "ASIA_SSO_KEY"
        mock_frozen.secret_key = "sso_secret_val"
        mock_frozen.token = "sso_session_tok"

        mock_creds = MagicMock()
        mock_creds.get_frozen_credentials.return_value = mock_frozen

        mock_session = MagicMock()
        mock_session.get_credentials.return_value = mock_creds

        with patch("boto3.Session", return_value=mock_session) as session_cls:
            env = get_cloud_credentials_env(project, db=db, strict=True)

        session_cls.assert_called_once_with(profile_name="Users-292785712872", region_name="ap-southeast-2")
        assert env["AWS_PROFILE"] == "Users-292785712872"
        assert env["AWS_ACCESS_KEY_ID"] == "ASIA_SSO_KEY"
        assert env["AWS_SECRET_ACCESS_KEY"] == "sso_secret_val"
        assert env["AWS_SESSION_TOKEN"] == "sso_session_tok"
        assert env["TF_VAR_aws_access_key_id"] == "ASIA_SSO_KEY"
        assert env["TF_VAR_aws_secret_access_key"] == "sso_secret_val"
        assert env["TF_VAR_aws_session_token"] == "sso_session_tok"
        assert env["TF_VAR_aws_region"] == "ap-southeast-2"

    def test_cloud_credentials_only_strips_aws_profile_when_keys_resolved(self, db):
        """Isolated artifact containers do not mount ~/.aws; AWS_PROFILE must be stripped when keys are resolved."""
        template = _make_template(
            db,
            name="AWS SSO Profile Container",
            aws_auth_method="profile",
            aws_profile="Users-292785712872",
            aws_access_key_id=None,
            aws_secret_access_key_encrypted=None,
            region="ap-southeast-2",
        )
        project = _make_project(db, credential_template_id=template.id)

        mock_frozen = MagicMock()
        mock_frozen.access_key = "ASIA_SSO_KEY"
        mock_frozen.secret_key = "sso_secret_val"
        mock_frozen.token = "sso_session_tok"

        mock_creds = MagicMock()
        mock_creds.get_frozen_credentials.return_value = mock_frozen

        mock_session = MagicMock()
        mock_session.get_credentials.return_value = mock_creds

        with patch("boto3.Session", return_value=mock_session):
            only_env = get_cloud_credentials_only(project, db=db, strict=True)

        assert "AWS_PROFILE" not in only_env
        assert only_env["AWS_ACCESS_KEY_ID"] == "ASIA_SSO_KEY"
        assert only_env["AWS_SECRET_ACCESS_KEY"] == "sso_secret_val"
        assert only_env["AWS_SESSION_TOKEN"] == "sso_session_tok"
        assert only_env["AWS_DEFAULT_REGION"] == "ap-southeast-2"

    @patch("services.credentials_service.decrypt_value", side_effect=["static_secret", None])
    def test_access_keys_clears_ambient_profile_and_session_token(self, _mock_dec, db, monkeypatch):
        """Binding an access_keys template without a session token clears ambient AWS_PROFILE and AWS_SESSION_TOKEN."""
        monkeypatch.setenv("AWS_PROFILE", "ambient-profile")
        monkeypatch.setenv("AWS_SESSION_TOKEN", "ambient-stale-token")
        monkeypatch.setenv("TF_VAR_aws_session_token", "ambient-stale-token")

        template = _make_template(
            db,
            name="Static Keys No Token",
            aws_auth_method="access_keys",
            aws_access_key_id="AKIA_STATIC",
            aws_secret_access_key_encrypted="enc_secret",
            aws_session_token_encrypted=None,
            region="ap-southeast-2",
        )
        project = _make_project(db, credential_template_id=template.id)

        env = get_cloud_credentials_env(project, db=db)

        assert "AWS_PROFILE" not in env
        assert "AWS_SESSION_TOKEN" not in env
        assert "TF_VAR_aws_session_token" not in env
        assert env["AWS_ACCESS_KEY_ID"] == "AKIA_STATIC"
        assert env["AWS_SECRET_ACCESS_KEY"] == "static_secret"

    def test_attach_aws_cli_credential_cache_wires_json_file_cache(self, tmp_path, monkeypatch):
        """attach_aws_cli_credential_cache configures botocore JSONFileCache on SSO/AssumeRole providers."""
        from services.credentials_service import attach_aws_cli_credential_cache

        cli_cache = tmp_path / ".aws" / "cli" / "cache"
        cli_cache.mkdir(parents=True)
        monkeypatch.setattr("os.path.expanduser", lambda p: str(cli_cache) if p == "~/.aws/cli/cache" else p)

        sso_provider = MagicMock()
        sso_provider.cache = None
        assume_role_provider = MagicMock()
        assume_role_provider.cache = None

        providers = {
            "sso": sso_provider,
            "assume-role": assume_role_provider,
            "assume-role-with-web-identity": None,
        }
        cred_resolver = MagicMock()
        cred_resolver.get_provider.side_effect = lambda name: providers.get(name)

        bc_session = MagicMock()
        bc_session.get_component.return_value = cred_resolver
        session = MagicMock()
        session._session = bc_session

        attach_aws_cli_credential_cache(session)

        assert sso_provider.cache is not None
        assert assume_role_provider.cache is not None
        assert sso_provider.cache is assume_role_provider.cache


class TestAWSVPCQuotaPreflight:
    """Verify AWS VPC quota preflight prevents VpcLimitExceeded partial deployments."""

    def test_vpc_preflight_blocks_when_at_limit(self):
        from tasks.opentofu_tasks import _check_aws_vpc_quota_preflight

        module = MagicMock()
        module.id = 72
        module.status = "initialized"
        module.source_path = "modules/eks-cluster-create"
        module.module_name = "aws_eks_cluster_create"
        module.variable_overrides = {"aws_region": "ap-southeast-2", "eks_cluster_name": "new-cluster"}
        module.variables = {}

        mock_ec2 = MagicMock()
        mock_ec2.describe_vpcs.return_value = {
            "Vpcs": [{"VpcId": f"vpc-{i}", "Tags": [{"Key": "Name", "Value": f"vpc-{i}"}]} for i in range(5)]
        }
        mock_sq = MagicMock()
        mock_sq.get_service_quota.return_value = {"Quota": {"Value": 5.0}}

        mock_session = MagicMock()
        mock_session.client.side_effect = lambda svc, **kw: mock_ec2 if svc == "ec2" else mock_sq

        with patch("boto3.Session", return_value=mock_session):
            with pytest.raises(ValueError, match="5/5 VPCs already in use"):
                _check_aws_vpc_quota_preflight(module, {"AWS_DEFAULT_REGION": "ap-southeast-2"})

    def test_vpc_preflight_passes_when_below_limit(self):
        from tasks.opentofu_tasks import _check_aws_vpc_quota_preflight

        module = MagicMock()
        module.id = 72
        module.status = "initialized"
        module.source_path = "modules/eks-cluster-create"
        module.module_name = "aws_eks_cluster_create"
        module.variable_overrides = {"aws_region": "ap-southeast-2", "eks_cluster_name": "new-cluster"}
        module.variables = {}

        mock_ec2 = MagicMock()
        mock_ec2.describe_vpcs.return_value = {
            "Vpcs": [{"VpcId": f"vpc-{i}", "Tags": [{"Key": "Name", "Value": f"vpc-{i}"}]} for i in range(3)]
        }
        mock_sq = MagicMock()
        mock_sq.get_service_quota.return_value = {"Quota": {"Value": 5.0}}

        mock_session = MagicMock()
        mock_session.client.side_effect = lambda svc, **kw: mock_ec2 if svc == "ec2" else mock_sq

        with patch("boto3.Session", return_value=mock_session):
            log_line = _check_aws_vpc_quota_preflight(module, {"AWS_DEFAULT_REGION": "ap-southeast-2"})

        assert "3/5 VPCs in use in ap-southeast-2" in log_line

    def test_vpc_preflight_idempotent_when_cluster_vpc_already_exists_at_limit(self):
        """When 5/5 VPCs exist but one is <eks_cluster_name>-vpc from variable_overrides, preflight passes."""
        from tasks.opentofu_tasks import _check_aws_vpc_quota_preflight

        module = MagicMock()
        module.id = 72
        module.status = "initialized"
        module.source_path = "modules/eks-cluster-create"
        module.module_name = "aws_eks_cluster_create"
        module.variable_overrides = {"aws_region": "ap-southeast-2", "eks_cluster_name": "my-eks"}
        module.variables = {}

        vpcs = [{"VpcId": f"vpc-{i}", "Tags": [{"Key": "Name", "Value": f"vpc-{i}"}]} for i in range(4)]
        vpcs.append({"VpcId": "vpc-existing", "Tags": [{"Key": "Name", "Value": "my-eks-vpc"}]})

        mock_ec2 = MagicMock()
        mock_ec2.describe_vpcs.return_value = {"Vpcs": vpcs}
        mock_sq = MagicMock()
        mock_sq.get_service_quota.return_value = {"Quota": {"Value": 5.0}}

        mock_session = MagicMock()
        mock_session.client.side_effect = lambda svc, **kw: mock_ec2 if svc == "ec2" else mock_sq

        with patch("boto3.Session", return_value=mock_session):
            log_line = _check_aws_vpc_quota_preflight(module, {})

        assert "existing VPC vpc-existing (my-eks-vpc) found in ap-southeast-2" in log_line

    def test_vpc_preflight_falls_back_to_describe_account_attributes_max_vpc(self):
        """When service-quotas raises AccessDenied, preflight falls back to ec2.describe_account_attributes(max-vpc)."""
        from tasks.opentofu_tasks import _check_aws_vpc_quota_preflight

        module = MagicMock()
        module.id = 72
        module.status = "initialized"
        module.source_path = "modules/eks-cluster-create"
        module.module_name = "aws_eks_cluster_create"
        module.variable_overrides = {"aws_region": "ap-southeast-2", "eks_cluster_name": "new-cluster"}
        module.variables = {}

        mock_ec2 = MagicMock()
        mock_ec2.describe_vpcs.return_value = {
            "Vpcs": [{"VpcId": f"vpc-{i}", "Tags": [{"Key": "Name", "Value": f"vpc-{i}"}]} for i in range(6)]
        }
        mock_ec2.describe_account_attributes.return_value = {
            "AccountAttributes": [{"AttributeName": "max-vpc", "AttributeValues": [{"AttributeValue": "10"}]}]
        }
        mock_sq = MagicMock()
        mock_sq.get_service_quota.side_effect = RuntimeError("AccessDeniedException")

        mock_session = MagicMock()
        mock_session.client.side_effect = lambda svc, **kw: mock_ec2 if svc == "ec2" else mock_sq

        with patch("boto3.Session", return_value=mock_session):
            log_line = _check_aws_vpc_quota_preflight(module, {})

        assert "6/10 VPCs in use in ap-southeast-2" in log_line

    def test_apply_known_module_hotfixes_covers_all_aws_eks_modules(self, tmp_path):
        """_apply_known_module_hotfixes updates main.tf and variables.tf across all 5 AWS EKS modules."""
        from services.execution.opentofu_runtime import _apply_known_module_hotfixes

        for mod_name in (
            "eks-cluster-create",
            "eks-cluster-register",
            "eks-cluster-hp-nodes",
            "eks-cluster-cneinstall",
            "eks-cluster-install-tmm-nads",
        ):
            mod_dir = tmp_path / mod_name
            mod_dir.mkdir()
            (mod_dir / "main.tf").write_text(
                'provider "aws" {\n'
                "  region     = var.aws_region\n"
                "  access_key = var.aws_access_key_id\n"
                "  secret_key = var.aws_secret_access_key\n"
                "}\n",
                encoding="utf-8",
            )
            (mod_dir / "variables.tf").write_text(
                'variable "aws_access_key_id" {\n'
                "  type      = string\n"
                "  sensitive = true\n"
                "}\n\n"
                'variable "aws_secret_access_key" {\n'
                "  type      = string\n"
                "  sensitive = true\n"
                "}\n",
                encoding="utf-8",
            )
            _apply_known_module_hotfixes(str(mod_dir), f"modules/{mod_name}")
            main_after = (mod_dir / "main.tf").read_text(encoding="utf-8")
            vars_after = (mod_dir / "variables.tf").read_text(encoding="utf-8")
            assert 'var.aws_access_key_id != "" ? var.aws_access_key_id : null' in main_after
            assert 'var.aws_secret_access_key != "" ? var.aws_secret_access_key : null' in main_after
            assert vars_after.count('default   = ""') == 2
