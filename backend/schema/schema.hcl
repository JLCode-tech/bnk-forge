table "alembic_version" {
  schema = schema.public
  column "version_num" {
    null = false
    type = character_varying(32)
  }
  primary_key "alembic_version_pkc" {
    columns = [column.version_num]
  }
}
table "alert_channels" {
  schema = schema.public
  column "id" {
    null = false
    type = serial
  }
  column "name" {
    null = false
    type = character_varying(255)
  }
  column "channel_type" {
    null = false
    type = character_varying(50)
  }
  column "enabled" {
    null = true
    type = boolean
  }
  column "url" {
    null = true
    type = text
  }
  column "headers" {
    null = true
    type = json
  }
  column "secret" {
    null = true
    type = text
  }
  column "email_to" {
    null = true
    type = json
  }
  column "email_from" {
    null = true
    type = character_varying(255)
  }
  column "event_types" {
    null = true
    type = json
  }
  column "project_ids" {
    null = true
    type = json
  }
  column "cluster_ids" {
    null = true
    type = json
  }
  column "min_interval_seconds" {
    null = true
    type = integer
  }
  column "last_fired_at" {
    null = true
    type = timestamptz
  }
  column "total_sent" {
    null = true
    type = integer
  }
  column "total_failed" {
    null = true
    type = integer
  }
  column "last_error" {
    null = true
    type = text
  }
  column "last_success_at" {
    null = true
    type = timestamptz
  }
  column "description" {
    null = true
    type = text
  }
  column "created_by" {
    null = true
    type = character_varying(255)
  }
  column "created_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  column "updated_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  index "ix_alert_channels_enabled" {
    columns = [column.enabled]
  }
  index "ix_alert_channels_id" {
    columns = [column.id]
  }
}
table "alert_history" {
  schema = schema.public
  column "id" {
    null = false
    type = serial
  }
  column "channel_id" {
    null = false
    type = integer
  }
  column "event_type" {
    null = false
    type = character_varying(50)
  }
  column "severity" {
    null = true
    type = character_varying(20)
  }
  column "title" {
    null = false
    type = character_varying(500)
  }
  column "message" {
    null = true
    type = text
  }
  column "project_id" {
    null = true
    type = integer
  }
  column "cluster_id" {
    null = true
    type = integer
  }
  column "payload" {
    null = true
    type = json
  }
  column "status" {
    null = true
    type = character_varying(20)
  }
  column "http_status_code" {
    null = true
    type = integer
  }
  column "response_body" {
    null = true
    type = text
  }
  column "error_message" {
    null = true
    type = text
  }
  column "duration_ms" {
    null = true
    type = integer
  }
  column "created_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "alert_history_channel_id_fkey" {
    columns     = [column.channel_id]
    ref_columns = [table.alert_channels.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  foreign_key "alert_history_cluster_id_fkey" {
    columns     = [column.cluster_id]
    ref_columns = [table.kubernetes_clusters.column.id]
    on_update   = NO_ACTION
    on_delete   = SET_NULL
  }
  foreign_key "alert_history_project_id_fkey" {
    columns     = [column.project_id]
    ref_columns = [table.projects.column.id]
    on_update   = NO_ACTION
    on_delete   = SET_NULL
  }
  index "idx_alert_history_channel_created" {
    columns = [column.channel_id, column.created_at]
  }
  index "idx_alert_history_created" {
    columns = [column.created_at]
  }
  index "idx_alert_history_event_type" {
    columns = [column.event_type]
  }
  index "ix_alert_history_channel_id" {
    columns = [column.channel_id]
  }
  index "ix_alert_history_created_at" {
    columns = [column.created_at]
  }
  index "ix_alert_history_id" {
    columns = [column.id]
  }
}
table "api_tokens" {
  schema = schema.public
  column "id" {
    null = false
    type = serial
  }
  column "user_id" {
    null = false
    type = integer
  }
  column "name" {
    null = false
    type = character_varying(255)
  }
  column "token_hash" {
    null = false
    type = character_varying(64)
  }
  column "token_prefix" {
    null = false
    type = character_varying(16)
  }
  column "role" {
    null = false
    type = character_varying(50)
  }
  column "expires_at" {
    null = true
    type = timestamptz
  }
  column "last_used_at" {
    null = true
    type = timestamptz
  }
  column "created_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "api_tokens_user_id_fkey" {
    columns     = [column.user_id]
    ref_columns = [table.users.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  index "ix_api_tokens_id" {
    columns = [column.id]
  }
  index "ix_api_tokens_token_hash" {
    unique  = true
    columns = [column.token_hash]
  }
  index "ix_api_tokens_token_prefix" {
    columns = [column.token_prefix]
  }
  index "ix_api_tokens_user_id" {
    columns = [column.user_id]
  }
}
table "application_settings" {
  schema = schema.public
  column "id" {
    null = false
    type = serial
  }
  column "key" {
    null = false
    type = character_varying(255)
  }
  column "value" {
    null = true
    type = text
  }
  column "value_type" {
    null = true
    type = character_varying(50)
  }
  column "description" {
    null = true
    type = text
  }
  column "category" {
    null = true
    type = character_varying(100)
  }
  column "is_encrypted" {
    null = true
    type = boolean
  }
  column "created_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  column "updated_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  index "ix_application_settings_category" {
    columns = [column.category]
  }
  index "ix_application_settings_id" {
    columns = [column.id]
  }
  index "ix_application_settings_key" {
    unique  = true
    columns = [column.key]
  }
}
table "audit_logs" {
  schema = schema.public
  column "id" {
    null = false
    type = serial
  }
  column "timestamp" {
    null    = false
    type    = timestamptz
    default = sql("now()")
  }
  column "user" {
    null = true
    type = character_varying(255)
  }
  column "user_id" {
    null = true
    type = integer
  }
  column "action" {
    null = false
    type = character_varying(100)
  }
  column "resource_type" {
    null = true
    type = character_varying(100)
  }
  column "resource_id" {
    null = true
    type = character_varying(255)
  }
  column "resource_name" {
    null = true
    type = character_varying(255)
  }
  column "status" {
    null = true
    type = character_varying(50)
  }
  column "details" {
    null = true
    type = json
  }
  column "ip_address" {
    null = true
    type = character_varying(50)
  }
  column "user_agent" {
    null = true
    type = character_varying(500)
  }
  column "http_method" {
    null = true
    type = character_varying(10)
  }
  column "http_path" {
    null = true
    type = character_varying(500)
  }
  column "http_status_code" {
    null = true
    type = integer
  }
  column "duration_ms" {
    null = true
    type = integer
  }
  column "request_id" {
    null = true
    type = character_varying(36)
  }
  column "created_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "audit_logs_user_id_fkey" {
    columns     = [column.user_id]
    ref_columns = [table.users.column.id]
    on_update   = NO_ACTION
    on_delete   = SET_NULL
  }
  index "idx_audit_resource" {
    columns = [column.resource_type, column.resource_id]
  }
  index "idx_audit_timestamp_action" {
    columns = [column.timestamp, column.action]
  }
  index "idx_audit_user_action" {
    columns = [column.user, column.action]
  }
  index "ix_audit_logs_action" {
    columns = [column.action]
  }
  index "ix_audit_logs_id" {
    columns = [column.id]
  }
  index "ix_audit_logs_request_id" {
    columns = [column.request_id]
  }
  index "ix_audit_logs_resource_type" {
    columns = [column.resource_type]
  }
  index "ix_audit_logs_timestamp" {
    columns = [column.timestamp]
  }
  index "ix_audit_logs_user" {
    columns = [column.user]
  }
}
table "bare_metal_deployment_steps" {
  schema = schema.public
  column "id" {
    null = false
    type = serial
  }
  column "deployment_id" {
    null = false
    type = integer
  }
  column "step_index" {
    null = false
    type = integer
  }
  column "phase" {
    null = false
    type = character_varying(50)
  }
  column "name" {
    null = false
    type = character_varying(255)
  }
  column "description" {
    null = true
    type = text
  }
  column "status" {
    null = false
    type = character_varying(50)
  }
  column "probe_result" {
    null = true
    type = json
  }
  column "already_done" {
    null = true
    type = boolean
  }
  column "connectivity_risk" {
    null = true
    type = boolean
  }
  column "connectivity_mechanism" {
    null = true
    type = character_varying(100)
  }
  column "started_at" {
    null = true
    type = timestamptz
  }
  column "completed_at" {
    null = true
    type = timestamptz
  }
  column "duration_seconds" {
    null = true
    type = double_precision
  }
  column "output_log" {
    null = true
    type = text
  }
  column "error_message" {
    null = true
    type = text
  }
  column "exit_code" {
    null = true
    type = integer
  }
  column "meta_data" {
    null = true
    type = json
  }
  column "created_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  column "updated_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "bare_metal_deployment_steps_deployment_id_fkey" {
    columns     = [column.deployment_id]
    ref_columns = [table.bare_metal_deployments.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  index "idx_bm_step_deploy_index" {
    unique  = true
    columns = [column.deployment_id, column.step_index]
  }
  index "idx_bm_step_status" {
    columns = [column.status]
  }
  index "ix_bare_metal_deployment_steps_deployment_id" {
    columns = [column.deployment_id]
  }
  index "ix_bare_metal_deployment_steps_id" {
    columns = [column.id]
  }
  index "ix_bare_metal_deployment_steps_status" {
    columns = [column.status]
  }
}
table "bare_metal_deployments" {
  schema = schema.public
  column "id" {
    null = false
    type = serial
  }
  column "host_id" {
    null = false
    type = integer
  }
  column "project_id" {
    null = false
    type = integer
  }
  column "topology" {
    null = false
    type = character_varying(50)
  }
  column "version_profile_snapshot" {
    null = true
    type = json
  }
  column "deployable_release_id" {
    null = true
    type = integer
  }
  column "status" {
    null = false
    type = character_varying(50)
  }
  column "current_phase" {
    null = true
    type = character_varying(50)
  }
  column "current_step_index" {
    null = true
    type = integer
  }
  column "celery_task_id" {
    null = true
    type = character_varying(255)
  }
  column "resume_from_step" {
    null = true
    type = integer
  }
  column "selected_phases" {
    null = true
    type = json
  }
  column "selected_steps" {
    null = true
    type = json
  }
  column "started_at" {
    null = true
    type = timestamptz
  }
  column "completed_at" {
    null = true
    type = timestamptz
  }
  column "duration_seconds" {
    null = true
    type = double_precision
  }
  column "error_message" {
    null = true
    type = text
  }
  column "error_phase" {
    null = true
    type = character_varying(50)
  }
  column "error_step_index" {
    null = true
    type = integer
  }
  column "triggered_by" {
    null = true
    type = character_varying(255)
  }
  column "created_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  column "updated_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "bare_metal_deployments_deployable_release_id_fkey" {
    columns     = [column.deployable_release_id]
    ref_columns = [table.bnk_deployable_release.column.id]
    on_update   = NO_ACTION
    on_delete   = SET_NULL
  }
  foreign_key "bare_metal_deployments_host_id_fkey" {
    columns     = [column.host_id]
    ref_columns = [table.bare_metal_hosts.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  foreign_key "bare_metal_deployments_project_id_fkey" {
    columns     = [column.project_id]
    ref_columns = [table.projects.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  index "idx_bm_deploy_created" {
    columns = [column.created_at]
  }
  index "idx_bm_deploy_host_status" {
    columns = [column.host_id, column.status]
  }
  index "idx_bm_deploy_project_status" {
    columns = [column.project_id, column.status]
  }
  index "ix_bare_metal_deployments_celery_task_id" {
    columns = [column.celery_task_id]
  }
  index "ix_bare_metal_deployments_host_id" {
    columns = [column.host_id]
  }
  index "ix_bare_metal_deployments_id" {
    columns = [column.id]
  }
  index "ix_bare_metal_deployments_project_id" {
    columns = [column.project_id]
  }
  index "ix_bare_metal_deployments_status" {
    columns = [column.status]
  }
}
table "bare_metal_hosts" {
  schema = schema.public
  column "id" {
    null = false
    type = serial
  }
  column "project_id" {
    null = false
    type = integer
  }
  column "name" {
    null = false
    type = character_varying(255)
  }
  column "description" {
    null = true
    type = text
  }
  column "hostname" {
    null = true
    type = character_varying(255)
  }
  column "host_ip" {
    null = false
    type = character_varying(255)
  }
  column "ssh_credential_id" {
    null = true
    type = integer
  }
  column "ssh_port" {
    null = true
    type = integer
  }
  column "dpu_credential_id" {
    null = true
    type = integer
  }
  column "jumphost_chain" {
    null = true
    type = json
  }
  column "bmc_ip" {
    null = true
    type = character_varying(255)
  }
  column "bmc_username_encrypted" {
    null = true
    type = text
  }
  column "bmc_password_encrypted" {
    null = true
    type = text
  }
  column "bmc_access_tier" {
    null = true
    type = character_varying(50)
  }
  column "bmc_vendor" {
    null = true
    type = character_varying(100)
  }
  column "ipmi_ip" {
    null = true
    type = character_varying(255)
  }
  column "ipmi_username_encrypted" {
    null = true
    type = text
  }
  column "ipmi_password_encrypted" {
    null = true
    type = text
  }
  column "topology" {
    null = true
    type = character_varying(50)
  }
  column "topology_auto_detected" {
    null = true
    type = boolean
  }
  column "network_mode" {
    null = true
    type = character_varying(20)
  }
  column "vlan_id" {
    null = true
    type = integer
  }
  column "gateway_ip" {
    null = true
    type = character_varying(255)
  }
  column "host_mgmt_ip" {
    null = true
    type = character_varying(255)
  }
  column "dpu_mgmt_ip" {
    null = true
    type = character_varying(255)
  }
  column "version_profile_id" {
    null = true
    type = integer
  }
  column "os_info" {
    null = true
    type = json
  }
  column "dpu_info" {
    null = true
    type = json
  }
  column "k8s_info" {
    null = true
    type = json
  }
  column "last_discovery_at" {
    null = true
    type = timestamptz
  }
  column "last_discovery_status" {
    null = true
    type = character_varying(32)
  }
  column "last_discovery_error" {
    null = true
    type = text
  }
  column "nic_mode" {
    null = true
    type = character_varying(50)
  }
  column "mst_device" {
    null = true
    type = character_varying(255)
  }
  column "rshim_present" {
    null = true
    type = boolean
  }
  column "default_route_iface" {
    null = true
    type = character_varying(100)
  }
  column "phase_c_deposited" {
    null = true
    type = boolean
  }
  column "phase_c_completed" {
    null = true
    type = boolean
  }
  column "pf_interfaces" {
    null = true
    type = json
  }
  column "vf_count" {
    null = true
    type = integer
  }
  column "hugepages_host_gb" {
    null = true
    type = integer
  }
  column "deploy_dpu_pci_address" {
    null = true
    type = character_varying(50)
  }
  column "deploy_dpu_index" {
    null = true
    type = integer
  }
  column "rshim_source" {
    null = true
    type = character_varying(20)
  }
  column "bond_mode" {
    null = true
    type = character_varying(20)
  }
  column "net_rshim_mac_base" {
    null = true
    type = character_varying(50)
  }
  column "last_discovery_result" {
    null = true
    type = json
  }
  column "kubernetes_cluster_id" {
    null = true
    type = integer
  }
  column "is_control_plane" {
    null    = false
    type    = boolean
    default = false
  }
  column "created_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  column "updated_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  column "created_by" {
    null = true
    type = character_varying(255)
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "bare_metal_hosts_dpu_credential_id_fkey" {
    columns     = [column.dpu_credential_id]
    ref_columns = [table.ssh_credentials.column.id]
    on_update   = NO_ACTION
    on_delete   = SET_NULL
  }
  foreign_key "bare_metal_hosts_kubernetes_cluster_id_fkey" {
    columns     = [column.kubernetes_cluster_id]
    ref_columns = [table.kubernetes_clusters.column.id]
    on_update   = NO_ACTION
    on_delete   = SET_NULL
  }
  foreign_key "bare_metal_hosts_project_id_fkey" {
    columns     = [column.project_id]
    ref_columns = [table.projects.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  foreign_key "bare_metal_hosts_ssh_credential_id_fkey" {
    columns     = [column.ssh_credential_id]
    ref_columns = [table.ssh_credentials.column.id]
    on_update   = NO_ACTION
    on_delete   = SET_NULL
  }
  foreign_key "bare_metal_hosts_version_profile_id_fkey" {
    columns     = [column.version_profile_id]
    ref_columns = [table.bnk_deployable_release.column.id]
    on_update   = NO_ACTION
    on_delete   = SET_NULL
  }
  index "idx_bm_host_project_ip" {
    columns = [column.project_id, column.host_ip]
  }
  index "idx_bm_host_project_name" {
    unique  = true
    columns = [column.project_id, column.name]
  }
  index "ix_bare_metal_hosts_id" {
    columns = [column.id]
  }
  index "ix_bare_metal_hosts_project_id" {
    columns = [column.project_id]
  }
}
table "benchmark_agents" {
  schema = schema.public
  column "id" {
    null = false
    type = serial
  }
  column "name" {
    null = false
    type = character_varying(255)
  }
  column "hostname" {
    null = true
    type = character_varying(255)
  }
  column "ip_address" {
    null = true
    type = character_varying(45)
  }
  column "tags" {
    null = true
    type = json
  }
  column "capabilities" {
    null = true
    type = json
  }
  column "status" {
    null = false
    type = character_varying(50)
  }
  column "last_heartbeat" {
    null = true
    type = timestamptz
  }
  column "project_id" {
    null = true
    type = integer
  }
  column "host_ip" {
    null = true
    type = character_varying(45)
  }
  column "ssh_credential_id" {
    null = true
    type = integer
  }
  column "ssh_port" {
    null = true
    type = integer
  }
  column "jumphost_chain" {
    null = true
    type = json
  }
  column "provision_status" {
    null = true
    type = character_varying(50)
  }
  column "provision_message" {
    null = true
    type = text
  }
  column "readiness" {
    null = true
    type = json
  }
  column "managed" {
    null = false
    type = boolean
  }
  column "created_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  column "updated_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "benchmark_agents_project_id_fkey" {
    columns     = [column.project_id]
    ref_columns = [table.projects.column.id]
    on_update   = NO_ACTION
    on_delete   = SET_NULL
  }
  foreign_key "benchmark_agents_ssh_credential_id_fkey" {
    columns     = [column.ssh_credential_id]
    ref_columns = [table.ssh_credentials.column.id]
    on_update   = NO_ACTION
    on_delete   = SET_NULL
  }
  index "idx_benchmark_agent_project" {
    columns = [column.project_id]
  }
  index "idx_benchmark_agent_status" {
    columns = [column.status]
  }
  index "ix_benchmark_agents_id" {
    columns = [column.id]
  }
  index "ix_benchmark_agents_name" {
    unique  = true
    columns = [column.name]
  }
  index "ix_benchmark_agents_project_id" {
    columns = [column.project_id]
  }
  index "ix_benchmark_agents_status" {
    columns = [column.status]
  }
}
table "benchmark_configs" {
  schema = schema.public
  column "id" {
    null = false
    type = serial
  }
  column "name" {
    null = false
    type = character_varying(255)
  }
  column "description" {
    null = true
    type = text
  }
  column "tool" {
    null = false
    type = character_varying(50)
  }
  column "config_json" {
    null = false
    type = json
  }
  column "created_by" {
    null = true
    type = character_varying(255)
  }
  column "created_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  column "updated_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  index "idx_benchmark_config_tool" {
    columns = [column.tool]
  }
  index "ix_benchmark_configs_id" {
    columns = [column.id]
  }
  index "ix_benchmark_configs_name" {
    unique  = true
    columns = [column.name]
  }
}
table "benchmark_run_groups" {
  schema = schema.public
  column "id" {
    null = false
    type = serial
  }
  column "scenario_key" {
    null = false
    type = character_varying(100)
  }
  column "scenario_name" {
    null = true
    type = character_varying(255)
  }
  column "run_label" {
    null = true
    type = character_varying(255)
  }
  column "target_id" {
    null = true
    type = integer
  }
  column "proxy_id" {
    null = true
    type = integer
  }
  column "agent_id" {
    null = true
    type = integer
  }
  column "proxy" {
    null = true
    type = character_varying(50)
  }
  column "model" {
    null = true
    type = character_varying(255)
  }
  column "base_url" {
    null = true
    type = character_varying(512)
  }
  column "tags" {
    null = true
    type = json
  }
  column "status" {
    null = false
    type = character_varying(50)
  }
  column "error_message" {
    null = true
    type = text
  }
  column "total_runs" {
    null = false
    type = integer
  }
  column "completed_runs" {
    null = false
    type = integer
  }
  column "failed_runs" {
    null = false
    type = integer
  }
  column "aggregate_json" {
    null = true
    type = json
  }
  column "avg_latency_p50" {
    null = true
    type = double_precision
  }
  column "avg_latency_p99" {
    null = true
    type = double_precision
  }
  column "peak_rps" {
    null = true
    type = double_precision
  }
  column "total_output_tokens" {
    null = true
    type = integer
  }
  column "started_at" {
    null = true
    type = timestamptz
  }
  column "completed_at" {
    null = true
    type = timestamptz
  }
  column "created_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  column "updated_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "benchmark_run_groups_agent_id_fkey" {
    columns     = [column.agent_id]
    ref_columns = [table.benchmark_agents.column.id]
    on_update   = NO_ACTION
    on_delete   = SET_NULL
  }
  foreign_key "benchmark_run_groups_proxy_id_fkey" {
    columns     = [column.proxy_id]
    ref_columns = [table.proxy_deployments.column.id]
    on_update   = NO_ACTION
    on_delete   = SET_NULL
  }
  foreign_key "benchmark_run_groups_target_id_fkey" {
    columns     = [column.target_id]
    ref_columns = [table.benchmark_targets.column.id]
    on_update   = NO_ACTION
    on_delete   = SET_NULL
  }
  index "idx_benchmark_run_group_scenario" {
    columns = [column.scenario_key]
  }
  index "idx_benchmark_run_group_status_created" {
    columns = [column.status, column.created_at]
  }
  index "idx_benchmark_run_group_target" {
    columns = [column.target_id]
  }
  index "ix_benchmark_run_groups_agent_id" {
    columns = [column.agent_id]
  }
  index "ix_benchmark_run_groups_created_at" {
    columns = [column.created_at]
  }
  index "ix_benchmark_run_groups_id" {
    columns = [column.id]
  }
  index "ix_benchmark_run_groups_proxy" {
    columns = [column.proxy]
  }
  index "ix_benchmark_run_groups_proxy_id" {
    columns = [column.proxy_id]
  }
  index "ix_benchmark_run_groups_status" {
    columns = [column.status]
  }
}
table "benchmark_runs" {
  schema = schema.public
  column "id" {
    null = false
    type = serial
  }
  column "tool" {
    null = false
    type = character_varying(50)
  }
  column "proxy" {
    null = false
    type = character_varying(50)
  }
  column "model" {
    null = false
    type = character_varying(255)
  }
  column "base_url" {
    null = false
    type = character_varying(512)
  }
  column "run_label" {
    null = true
    type = character_varying(255)
  }
  column "tags" {
    null = true
    type = json
  }
  column "config_id" {
    null = true
    type = integer
  }
  column "agent_id" {
    null = true
    type = integer
  }
  column "target_id" {
    null = true
    type = integer
  }
  column "proxy_deployment_id" {
    null = true
    type = integer
  }
  column "run_group_id" {
    null = true
    type = integer
  }
  column "scenario_key" {
    null = true
    type = character_varying(100)
  }
  column "variant_label" {
    null = true
    type = character_varying(100)
  }
  column "is_baseline" {
    null    = false
    type    = boolean
    default = false
  }
  column "status" {
    null = false
    type = character_varying(50)
  }
  column "error_message" {
    null = true
    type = text
  }
  column "config_snapshot" {
    null = true
    type = json
  }
  column "result_json" {
    null = true
    type = json
  }
  column "duration_seconds" {
    null = true
    type = double_precision
  }
  column "total_requests" {
    null = true
    type = integer
  }
  column "successful_requests" {
    null = true
    type = integer
  }
  column "failed_requests" {
    null = true
    type = integer
  }
  column "success_rate_pct" {
    null = true
    type = double_precision
  }
  column "latency_p50" {
    null = true
    type = double_precision
  }
  column "latency_p99" {
    null = true
    type = double_precision
  }
  column "overall_rps" {
    null = true
    type = double_precision
  }
  column "peak_rps" {
    null = true
    type = double_precision
  }
  column "tokens_per_sec" {
    null = true
    type = double_precision
  }
  column "total_output_tokens" {
    null = true
    type = integer
  }
  column "started_at" {
    null = true
    type = timestamptz
  }
  column "completed_at" {
    null = true
    type = timestamptz
  }
  column "created_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  column "updated_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "benchmark_runs_agent_id_fkey" {
    columns     = [column.agent_id]
    ref_columns = [table.benchmark_agents.column.id]
    on_update   = NO_ACTION
    on_delete   = SET_NULL
  }
  foreign_key "benchmark_runs_config_id_fkey" {
    columns     = [column.config_id]
    ref_columns = [table.benchmark_configs.column.id]
    on_update   = NO_ACTION
    on_delete   = SET_NULL
  }
  foreign_key "benchmark_runs_proxy_deployment_id_fkey" {
    columns     = [column.proxy_deployment_id]
    ref_columns = [table.proxy_deployments.column.id]
    on_update   = NO_ACTION
    on_delete   = SET_NULL
  }
  foreign_key "benchmark_runs_run_group_id_fkey" {
    columns     = [column.run_group_id]
    ref_columns = [table.benchmark_run_groups.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  foreign_key "benchmark_runs_target_id_fkey" {
    columns     = [column.target_id]
    ref_columns = [table.benchmark_targets.column.id]
    on_update   = NO_ACTION
    on_delete   = SET_NULL
  }
  index "idx_benchmark_run_group" {
    columns = [column.run_group_id]
  }
  index "idx_benchmark_run_model" {
    columns = [column.model]
  }
  index "idx_benchmark_run_proxy_created" {
    columns = [column.proxy, column.created_at]
  }
  index "idx_benchmark_run_status_created" {
    columns = [column.status, column.created_at]
  }
  index "idx_benchmark_run_target" {
    columns = [column.target_id]
  }
  index "idx_benchmark_run_tool_proxy" {
    columns = [column.tool, column.proxy]
  }
  index "ix_benchmark_runs_agent_id" {
    columns = [column.agent_id]
  }
  index "ix_benchmark_runs_config_id" {
    columns = [column.config_id]
  }
  index "ix_benchmark_runs_created_at" {
    columns = [column.created_at]
  }
  index "ix_benchmark_runs_id" {
    columns = [column.id]
  }
  index "ix_benchmark_runs_is_baseline" {
    columns = [column.is_baseline]
  }
  index "ix_benchmark_runs_model" {
    columns = [column.model]
  }
  index "ix_benchmark_runs_proxy" {
    columns = [column.proxy]
  }
  index "ix_benchmark_runs_proxy_deployment_id" {
    columns = [column.proxy_deployment_id]
  }
  index "ix_benchmark_runs_scenario_key" {
    columns = [column.scenario_key]
  }
  index "ix_benchmark_runs_status" {
    columns = [column.status]
  }
  index "ix_benchmark_runs_tool" {
    columns = [column.tool]
  }
}
table "benchmark_targets" {
  schema = schema.public
  column "id" {
    null = false
    type = serial
  }
  column "name" {
    null = false
    type = character_varying(255)
  }
  column "description" {
    null = true
    type = text
  }
  column "cluster_id" {
    null = false
    type = integer
  }
  column "llm_base_url" {
    null = false
    type = character_varying(500)
  }
  column "llm_model" {
    null = false
    type = character_varying(255)
  }
  column "llm_namespace" {
    null = false
    type = character_varying(255)
  }
  column "llm_endpoint" {
    null = false
    type = character_varying(255)
  }
  column "proxy_namespace" {
    null = false
    type = character_varying(255)
  }
  column "status" {
    null = false
    type = character_varying(50)
  }
  column "last_validated" {
    null = true
    type = timestamptz
  }
  column "validation_msg" {
    null = true
    type = text
  }
  column "tags" {
    null = true
    type = json
  }
  column "created_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  column "updated_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "benchmark_targets_cluster_id_fkey" {
    columns     = [column.cluster_id]
    ref_columns = [table.kubernetes_clusters.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  index "idx_benchmark_target_cluster" {
    columns = [column.cluster_id]
  }
  index "idx_benchmark_target_status" {
    columns = [column.status]
  }
  index "ix_benchmark_targets_cluster_id" {
    columns = [column.cluster_id]
  }
  index "ix_benchmark_targets_id" {
    columns = [column.id]
  }
  index "ix_benchmark_targets_name" {
    columns = [column.name]
  }
  index "ix_benchmark_targets_status" {
    columns = [column.status]
  }
  unique "uq_benchmark_targets_cluster_name" {
    columns = [column.cluster_id, column.name]
  }
}
table "bf_conf_templates" {
  schema = schema.public
  column "id" {
    null = false
    type = serial
  }
  column "name" {
    null = false
    type = character_varying(255)
  }
  column "description" {
    null = true
    type = text
  }
  column "content" {
    null = false
    type = text
  }
  column "matching_bnk_version" {
    null = true
    type = character_varying(64)
  }
  column "created_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  column "updated_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  index "ix_bf_conf_templates_id" {
    columns = [column.id]
  }
  unique "bf_conf_templates_name_key" {
    columns = [column.name]
  }
}
table "bluefield_software_images" {
  schema = schema.public
  column "id" {
    null = false
    type = serial
  }
  column "image_filename" {
    null = true
    type = character_varying(255)
  }
  column "base_url" {
    null = true
    type = character_varying(512)
  }
  column "doca_version" {
    null = true
    type = character_varying(64)
  }
  column "doca_package" {
    null = true
    type = character_varying(255)
  }
  column "host_os" {
    null = true
    type = character_varying(32)
  }
  column "host_os_version" {
    null = true
    type = character_varying(32)
  }
  column "host_arch" {
    null = true
    type = character_varying(32)
  }
  column "doca_host_url" {
    null = true
    type = character_varying(512)
  }
  column "is_default" {
    null    = false
    type    = boolean
    default = false
  }
  column "notes" {
    null = true
    type = text
  }
  column "created_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  column "updated_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  index "ix_bluefield_software_images_id" {
    columns = [column.id]
  }
  unique "uq_doca_release" {
    columns = [column.doca_version, column.host_os, column.host_os_version, column.host_arch]
  }
}
table "blueprint_releases" {
  schema = schema.public
  column "id" {
    null = false
    type = serial
  }
  column "blueprint_source_id" {
    null = false
    type = integer
  }
  column "blueprint_id" {
    null = false
    type = character_varying(255)
  }
  column "blueprint_version" {
    null = false
    type = character_varying(100)
  }
  column "blueprint_name" {
    null = false
    type = character_varying(255)
  }
  column "blueprint_description" {
    null = true
    type = text
  }
  column "schema_version" {
    null = false
    type = integer
  }
  column "source_path" {
    null = true
    type = character_varying(500)
  }
  column "source_ref" {
    null = true
    type = character_varying(255)
  }
  column "content_sha256" {
    null = false
    type = character_varying(64)
  }
  column "manifest" {
    null = false
    type = json
  }
  column "validation_state" {
    null = false
    type = character_varying(50)
  }
  column "validation_errors" {
    null = true
    type = json
  }
  column "release_state" {
    null = false
    type = character_varying(50)
  }
  column "state_reason" {
    null = true
    type = text
  }
  column "is_active" {
    null = false
    type = boolean
  }
  column "imported_at" {
    null = true
    type = timestamptz
  }
  column "created_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  column "updated_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "blueprint_releases_blueprint_source_id_fkey" {
    columns     = [column.blueprint_source_id]
    ref_columns = [table.blueprint_sources.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  index "idx_blueprint_release_identity" {
    columns = [column.blueprint_id, column.blueprint_version]
  }
  index "idx_blueprint_release_state" {
    columns = [column.release_state]
  }
  index "idx_blueprint_release_validation" {
    columns = [column.validation_state]
  }
  index "ix_blueprint_releases_blueprint_id" {
    columns = [column.blueprint_id]
  }
  index "ix_blueprint_releases_blueprint_source_id" {
    columns = [column.blueprint_source_id]
  }
  index "ix_blueprint_releases_id" {
    columns = [column.id]
  }
  index "ix_blueprint_releases_is_active" {
    columns = [column.is_active]
  }
  index "ix_blueprint_releases_release_state" {
    columns = [column.release_state]
  }
  index "ix_blueprint_releases_validation_state" {
    columns = [column.validation_state]
  }
  unique "uq_blueprint_release_source_identity_version" {
    columns = [column.blueprint_source_id, column.blueprint_id, column.blueprint_version]
  }
}
table "blueprint_sources" {
  schema = schema.public
  column "id" {
    null = false
    type = serial
  }
  column "name" {
    null = false
    type = character_varying(255)
  }
  column "source_type" {
    null = false
    type = character_varying(50)
  }
  column "url" {
    null = false
    type = character_varying(500)
  }
  column "branch" {
    null = true
    type = character_varying(100)
  }
  column "git_ref" {
    null = true
    type = character_varying(100)
  }
  column "sync_status" {
    null = false
    type = character_varying(50)
  }
  column "sync_error" {
    null = true
    type = text
  }
  column "last_synced_at" {
    null = true
    type = timestamptz
  }
  column "release_count" {
    null = false
    type = integer
  }
  column "is_active" {
    null = false
    type = boolean
  }
  column "description" {
    null = true
    type = text
  }
  column "created_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  column "updated_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  index "idx_blueprint_source_active" {
    columns = [column.is_active]
  }
  index "idx_blueprint_source_status" {
    columns = [column.sync_status]
  }
  index "idx_blueprint_source_type" {
    columns = [column.source_type]
  }
  index "ix_blueprint_sources_id" {
    columns = [column.id]
  }
  index "ix_blueprint_sources_is_active" {
    columns = [column.is_active]
  }
  index "ix_blueprint_sources_name" {
    unique  = true
    columns = [column.name]
  }
  index "ix_blueprint_sources_source_type" {
    columns = [column.source_type]
  }
  index "ix_blueprint_sources_sync_status" {
    columns = [column.sync_status]
  }
}
table "bnk_cluster_configs" {
  schema = schema.public
  column "id" {
    null = false
    type = serial
  }
  column "cluster_id" {
    null = false
    type = integer
  }
  column "tmfifo_pool_cidr" {
    null = false
    type = character_varying(64)
  }
  column "join_transport" {
    null = false
    type = character_varying(32)
  }
  column "control_plane_host_id" {
    null = true
    type = integer
  }
  column "created_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  column "updated_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "bnk_cluster_configs_cluster_id_fkey" {
    columns     = [column.cluster_id]
    ref_columns = [table.kubernetes_clusters.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  foreign_key "bnk_cluster_configs_control_plane_host_id_fkey" {
    columns     = [column.control_plane_host_id]
    ref_columns = [table.bare_metal_hosts.column.id]
    on_update   = NO_ACTION
    on_delete   = SET_NULL
  }
  index "ix_bnk_cluster_configs_cluster_id" {
    unique  = true
    columns = [column.cluster_id]
  }
  index "ix_bnk_cluster_configs_id" {
    columns = [column.id]
  }
}
table "bnk_deployable_release" {
  schema = schema.public
  column "id" {
    null = false
    type = serial
  }
  column "name" {
    null = false
    type = character_varying(100)
  }
  column "display_name" {
    null = false
    type = character_varying(255)
  }
  column "description" {
    null = true
    type = text
  }
  column "is_default" {
    null = true
    type = boolean
  }
  column "is_active" {
    null = true
    type = boolean
  }
  column "source_type" {
    null = false
    type = character_varying(30)
  }
  column "bnk_release_id" {
    null = true
    type = integer
  }
  column "bnk_manifest_version" {
    null = false
    type = character_varying(50)
  }
  column "bnk_cr_kind" {
    null = false
    type = character_varying(50)
  }
  column "flo_version" {
    null = false
    type = character_varying(50)
  }
  column "k8s_version" {
    null = false
    type = character_varying(50)
  }
  column "doca_version" {
    null = false
    type = character_varying(50)
  }
  column "containerd_version" {
    null = false
    type = character_varying(50)
  }
  column "runc_version" {
    null = false
    type = character_varying(50)
  }
  column "calico_version" {
    null = false
    type = character_varying(50)
  }
  column "cert_manager_version" {
    null = false
    type = character_varying(50)
  }
  column "gateway_api_version" {
    null = false
    type = character_varying(50)
  }
  column "multus_version" {
    null = false
    type = character_varying(50)
  }
  column "sriov_version" {
    null = false
    type = character_varying(50)
  }
  column "storage_class_type" {
    null = false
    type = character_varying(50)
  }
  column "storage_provisioner" {
    null = false
    type = character_varying(255)
  }
  column "feature_flags" {
    null = true
    type = json
  }
  column "full_manifest" {
    null = true
    type = json
  }
  column "source_id" {
    null = true
    type = integer
  }
  column "last_synced" {
    null = true
    type = timestamptz
  }
  column "created_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  column "updated_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "bnk_deployable_release_bnk_release_id_fkey" {
    columns     = [column.bnk_release_id]
    ref_columns = [table.bnk_releases.column.id]
    on_update   = NO_ACTION
    on_delete   = SET_NULL
  }
  foreign_key "bnk_deployable_release_source_id_fkey" {
    columns     = [column.source_id]
    ref_columns = [table.release_source.column.id]
    on_update   = NO_ACTION
    on_delete   = SET_NULL
  }
  index "idx_bnk_deployable_release_active" {
    columns = [column.is_active]
  }
  index "idx_bnk_deployable_release_default" {
    columns = [column.is_default]
  }
  index "idx_bnk_deployable_release_name" {
    columns = [column.name]
  }
  index "ix_bnk_deployable_release_id" {
    columns = [column.id]
  }
  index "ix_bnk_deployable_release_name" {
    unique  = true
    columns = [column.name]
  }
}
table "bnk_releases" {
  schema = schema.public
  column "id" {
    null = false
    type = serial
  }
  column "ga_label" {
    null = false
    type = character_varying(100)
  }
  column "product_line" {
    null = false
    type = character_varying(50)
  }
  column "manifest_version" {
    null = true
    type = character_varying(100)
  }
  column "flo_version_prefix" {
    null = true
    type = character_varying(50)
  }
  column "flo_version_min" {
    null = true
    type = character_varying(50)
  }
  column "flo_version_max" {
    null = true
    type = character_varying(50)
  }
  column "min_k8s" {
    null = true
    type = character_varying(20)
  }
  column "max_k8s" {
    null = true
    type = character_varying(20)
  }
  column "release_date" {
    null = true
    type = timestamptz
  }
  column "source_type" {
    null = false
    type = character_varying(30)
  }
  column "source_url" {
    null = true
    type = text
  }
  column "notes" {
    null = true
    type = text
  }
  column "is_active" {
    null = false
    type = boolean
  }
  column "created_at" {
    null    = false
    type    = timestamptz
    default = sql("now()")
  }
  column "updated_at" {
    null    = false
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  index "idx_bnk_release_active" {
    columns = [column.is_active]
  }
  index "idx_bnk_release_flo_prefix" {
    columns = [column.flo_version_prefix]
  }
  index "idx_bnk_release_ga_label" {
    columns = [column.ga_label]
  }
}
table "bnk_upgrades" {
  schema = schema.public
  column "id" {
    null = false
    type = serial
  }
  column "cluster_id" {
    null = false
    type = integer
  }
  column "project_id" {
    null = true
    type = integer
  }
  column "from_version" {
    null = true
    type = character_varying(100)
  }
  column "to_version" {
    null = false
    type = character_varying(100)
  }
  column "from_bnk_info" {
    null = true
    type = json
  }
  column "plan" {
    null = true
    type = json
  }
  column "total_steps" {
    null = true
    type = integer
  }
  column "current_step" {
    null = true
    type = integer
  }
  column "pre_checks" {
    null = true
    type = json
  }
  column "pre_check_passed" {
    null = true
    type = boolean
  }
  column "status" {
    null = false
    type = character_varying(50)
  }
  column "celery_task_id" {
    null = true
    type = character_varying(255)
  }
  column "step_results" {
    null = true
    type = json
  }
  column "pre_health" {
    null = true
    type = json
  }
  column "post_health" {
    null = true
    type = json
  }
  column "health_gate_passed" {
    null = true
    type = boolean
  }
  column "rollback_available" {
    null = true
    type = boolean
  }
  column "rollback_info" {
    null = true
    type = json
  }
  column "rollback_reason" {
    null = true
    type = text
  }
  column "started_at" {
    null = true
    type = timestamptz
  }
  column "completed_at" {
    null = true
    type = timestamptz
  }
  column "duration_seconds" {
    null = true
    type = double_precision
  }
  column "error_message" {
    null = true
    type = text
  }
  column "error_step" {
    null = true
    type = integer
  }
  column "triggered_by" {
    null = true
    type = character_varying(255)
  }
  column "approved_by" {
    null = true
    type = character_varying(255)
  }
  column "lock_fence_token" {
    null    = false
    type    = bigint
    default = 0
  }
  column "holding_task_id" {
    null = true
    type = bigint
  }
  column "heartbeat_at" {
    null = true
    type = timestamptz
  }
  column "lock_acquired_at" {
    null = true
    type = timestamptz
  }
  column "created_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  column "updated_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "bnk_upgrades_cluster_id_fkey" {
    columns     = [column.cluster_id]
    ref_columns = [table.kubernetes_clusters.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  foreign_key "bnk_upgrades_project_id_fkey" {
    columns     = [column.project_id]
    ref_columns = [table.projects.column.id]
    on_update   = NO_ACTION
    on_delete   = SET_NULL
  }
  index "idx_bnk_upgrade_cluster_status" {
    columns = [column.cluster_id, column.status]
  }
  index "idx_bnk_upgrade_created" {
    columns = [column.created_at]
  }
  index "ix_bnk_upgrades_celery_task_id" {
    columns = [column.celery_task_id]
  }
  index "ix_bnk_upgrades_cluster_id" {
    columns = [column.cluster_id]
  }
  index "ix_bnk_upgrades_id" {
    columns = [column.id]
  }
  index "ix_bnk_upgrades_project_id" {
    columns = [column.project_id]
  }
  index "ix_bnk_upgrades_status" {
    columns = [column.status]
  }
}
table "cloud_credential_templates" {
  schema = schema.public
  column "id" {
    null = false
    type = serial
  }
  column "name" {
    null = false
    type = character_varying(255)
  }
  column "description" {
    null = true
    type = text
  }
  column "provider" {
    null = false
    type = character_varying(50)
  }
  column "aws_auth_method" {
    null = true
    type = character_varying(50)
  }
  column "aws_profile" {
    null = true
    type = character_varying(100)
  }
  column "region" {
    null = true
    type = character_varying(50)
  }
  column "aws_access_key_id" {
    null = true
    type = character_varying(100)
  }
  column "aws_secret_access_key_encrypted" {
    null = true
    type = text
  }
  column "aws_session_token_encrypted" {
    null = true
    type = text
  }
  column "aws_credentials_expiry" {
    null = true
    type = timestamptz
  }
  column "aws_sso_enabled" {
    null = true
    type = boolean
  }
  column "aws_sso_start_url" {
    null = true
    type = character_varying(500)
  }
  column "aws_sso_region" {
    null = true
    type = character_varying(50)
  }
  column "aws_sso_account_id" {
    null = true
    type = character_varying(20)
  }
  column "aws_sso_role_name" {
    null = true
    type = character_varying(255)
  }
  column "aws_sso_access_token_encrypted" {
    null = true
    type = text
  }
  column "aws_sso_refresh_token_encrypted" {
    null = true
    type = text
  }
  column "aws_sso_client_id" {
    null = true
    type = character_varying(255)
  }
  column "aws_sso_client_secret_encrypted" {
    null = true
    type = text
  }
  column "aws_sso_token_expiry" {
    null = true
    type = timestamptz
  }
  column "aws_sso_authenticated_at" {
    null = true
    type = timestamptz
  }
  column "gcp_credentials_encrypted" {
    null = true
    type = text
  }
  column "gcp_project_id" {
    null = true
    type = character_varying(255)
  }
  column "azure_subscription_id" {
    null = true
    type = character_varying(255)
  }
  column "azure_tenant_id" {
    null = true
    type = character_varying(255)
  }
  column "azure_credentials_encrypted" {
    null = true
    type = text
  }
  column "ibmcloud_api_key_encrypted" {
    null = true
    type = text
  }
  column "ibmcloud_resource_group" {
    null = true
    type = character_varying(255)
  }
  column "ibm_cos_instance_name" {
    null = true
    type = character_varying(255)
  }
  column "ibm_cos_instance_crn" {
    null = true
    type = text
  }
  column "ibm_cos_hmac_access_key_id" {
    null = true
    type = character_varying(255)
  }
  column "ibm_cos_hmac_secret_access_key_encrypted" {
    null = true
    type = text
  }
  column "ibm_iam_token_encrypted" {
    null = true
    type = text
  }
  column "ibm_iam_token_expiry" {
    null = true
    type = timestamptz
  }
  column "tfc_api_token_encrypted" {
    null = true
    type = text
  }
  column "tfc_hostname" {
    null = true
    type = character_varying(255)
  }
  column "ssh_host" {
    null = true
    type = character_varying(255)
  }
  column "ssh_port" {
    null = true
    type = integer
  }
  column "ssh_username" {
    null = true
    type = character_varying(255)
  }
  column "ssh_auth_type" {
    null = true
    type = character_varying(50)
  }
  column "ssh_password_encrypted" {
    null = true
    type = text
  }
  column "ssh_key_encrypted" {
    null = true
    type = text
  }
  column "ssh_key_passphrase_encrypted" {
    null = true
    type = text
  }
  column "credentials_encrypted" {
    null = true
    type = text
  }
  column "last_successful_call_at" {
    null = true
    type = timestamptz
  }
  column "last_error_at" {
    null = true
    type = timestamptz
  }
  column "last_error_code" {
    null = true
    type = character_varying(64)
  }
  column "last_error_message" {
    null = true
    type = text
  }
  column "is_default" {
    null = true
    type = boolean
  }
  column "created_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  column "updated_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  column "created_by" {
    null = true
    type = character_varying(255)
  }
  column "azure_auth_method" {
    null = true
    type = character_varying(50)
  }
  column "azure_client_id" {
    null = true
    type = character_varying(255)
  }
  column "azure_client_secret_encrypted" {
    null = true
    type = text
  }
  column "azure_sso_access_token_encrypted" {
    null = true
    type = text
  }
  column "azure_sso_refresh_token_encrypted" {
    null = true
    type = text
  }
  column "azure_sso_token_expiry" {
    null = true
    type = timestamptz
  }
  column "azure_sso_authenticated_at" {
    null = true
    type = timestamptz
  }
  primary_key {
    columns = [column.id]
  }
  index "ix_cloud_credential_templates_id" {
    columns = [column.id]
  }
  index "ix_cloud_credential_templates_name" {
    unique  = true
    columns = [column.name]
  }
}
table "config_promotions" {
  schema = schema.public
  column "id" {
    null = false
    type = serial
  }
  column "source_cluster_id" {
    null = true
    type = integer
  }
  column "target_cluster_id" {
    null = true
    type = integer
  }
  column "source_cluster_name" {
    null = false
    type = character_varying(255)
  }
  column "target_cluster_name" {
    null = false
    type = character_varying(255)
  }
  column "change_count" {
    null = false
    type = integer
  }
  column "changes_summary" {
    null = true
    type = json
  }
  column "applied_by" {
    null = true
    type = character_varying(255)
  }
  column "success" {
    null = true
    type = boolean
  }
  column "error_message" {
    null = true
    type = character_varying(1000)
  }
  column "applied_count" {
    null = true
    type = integer
  }
  column "failed_count" {
    null = true
    type = integer
  }
  column "skipped_count" {
    null = true
    type = integer
  }
  column "applied_at" {
    null    = false
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "config_promotions_source_cluster_id_fkey" {
    columns     = [column.source_cluster_id]
    ref_columns = [table.kubernetes_clusters.column.id]
    on_update   = NO_ACTION
    on_delete   = SET_NULL
  }
  foreign_key "config_promotions_target_cluster_id_fkey" {
    columns     = [column.target_cluster_id]
    ref_columns = [table.kubernetes_clusters.column.id]
    on_update   = NO_ACTION
    on_delete   = SET_NULL
  }
  index "idx_config_promotion_applied_at" {
    columns = [column.applied_at]
  }
  index "idx_config_promotion_source" {
    columns = [column.source_cluster_id]
  }
  index "idx_config_promotion_target" {
    columns = [column.target_cluster_id]
  }
  index "ix_config_promotions_id" {
    columns = [column.id]
  }
}
table "config_snapshots" {
  schema = schema.public
  column "id" {
    null = false
    type = serial
  }
  column "project_id" {
    null = false
    type = integer
  }
  column "cluster_id" {
    null = true
    type = integer
  }
  column "trigger" {
    null = false
    type = character_varying(50)
  }
  column "label" {
    null = true
    type = character_varying(255)
  }
  column "created_by" {
    null = true
    type = character_varying(255)
  }
  column "config_data" {
    null = false
    type = json
  }
  column "resource_count" {
    null = true
    type = integer
  }
  column "module_count" {
    null = true
    type = integer
  }
  column "created_at" {
    null    = false
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "config_snapshots_cluster_id_fkey" {
    columns     = [column.cluster_id]
    ref_columns = [table.kubernetes_clusters.column.id]
    on_update   = NO_ACTION
    on_delete   = SET_NULL
  }
  foreign_key "config_snapshots_project_id_fkey" {
    columns     = [column.project_id]
    ref_columns = [table.projects.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  index "idx_config_snapshot_project" {
    columns = [column.project_id]
  }
  index "idx_config_snapshot_project_created" {
    columns = [column.project_id, column.created_at]
  }
  index "idx_config_snapshot_trigger" {
    columns = [column.trigger]
  }
  index "ix_config_snapshots_id" {
    columns = [column.id]
  }
}
table "connected_operators" {
  schema = schema.public
  column "id" {
    null = false
    type = serial
  }
  column "operator_id" {
    null = false
    type = character_varying(64)
  }
  column "registration_token_id" {
    null = true
    type = integer
  }
  column "cluster_name" {
    null = false
    type = character_varying(255)
  }
  column "cluster_id" {
    null = true
    type = integer
  }
  column "connectivity_mode" {
    null    = false
    type    = character_varying(50)
    default = "direct_ws"
  }
  column "connectivity_config" {
    null = true
    type = json
  }
  column "labels" {
    null = true
    type = json
  }
  column "is_connected" {
    null = false
    type = boolean
  }
  column "last_heartbeat_at" {
    null = true
    type = timestamptz
  }
  column "last_connected_at" {
    null = true
    type = timestamptz
  }
  column "last_disconnected_at" {
    null = true
    type = timestamptz
  }
  column "disconnect_reason" {
    null = true
    type = character_varying(500)
  }
  column "operator_version" {
    null = true
    type = character_varying(50)
  }
  column "kubernetes_version" {
    null = true
    type = character_varying(50)
  }
  column "node_count" {
    null = true
    type = integer
  }
  column "nodes_ready" {
    null = true
    type = integer
  }
  column "last_health_report" {
    null = true
    type = json
  }
  column "last_health_at" {
    null = true
    type = timestamptz
  }
  column "commands_executed" {
    null = false
    type = integer
  }
  column "commands_failed" {
    null = false
    type = integer
  }
  column "uptime_seconds" {
    null = false
    type = integer
  }
  column "status" {
    null = false
    type = character_varying(50)
  }
  column "created_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  column "updated_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "connected_operators_cluster_id_fkey" {
    columns     = [column.cluster_id]
    ref_columns = [table.kubernetes_clusters.column.id]
    on_update   = NO_ACTION
    on_delete   = SET_NULL
  }
  foreign_key "connected_operators_registration_token_id_fkey" {
    columns     = [column.registration_token_id]
    ref_columns = [table.operator_registration_tokens.column.id]
    on_update   = NO_ACTION
    on_delete   = SET_NULL
  }
  index "idx_op_cluster_name" {
    columns = [column.cluster_name]
  }
  index "idx_op_connected_status" {
    columns = [column.is_connected, column.status]
  }
  index "ix_connected_operators_cluster_id" {
    columns = [column.cluster_id]
  }
  index "ix_connected_operators_cluster_name" {
    columns = [column.cluster_name]
  }
  index "ix_connected_operators_connectivity_mode" {
    columns = [column.connectivity_mode]
  }
  index "ix_connected_operators_id" {
    columns = [column.id]
  }
  index "ix_connected_operators_is_connected" {
    columns = [column.is_connected]
  }
  index "ix_connected_operators_operator_id" {
    unique  = true
    columns = [column.operator_id]
  }
  index "ix_connected_operators_status" {
    columns = [column.status]
  }
}
table "container_registries" {
  schema = schema.public
  column "id" {
    null = false
    type = serial
  }
  column "name" {
    null = false
    type = character_varying(255)
  }
  column "description" {
    null = true
    type = text
  }
  column "type" {
    null = false
    type = character_varying(20)
  }
  column "registry_host" {
    null = false
    type = character_varying(255)
  }
  column "username" {
    null = true
    type = character_varying(255)
  }
  column "token_encrypted" {
    null = true
    type = text
  }
  column "far_service_account_encrypted" {
    null = true
    type = text
  }
  column "credential_template_id" {
    null = true
    type = integer
  }
  column "created_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  column "updated_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  column "created_by" {
    null = true
    type = character_varying(255)
  }
  column "last_test_status" {
    null = true
    type = character_varying(32)
  }
  column "last_test_at" {
    null = true
    type = timestamptz
  }
  column "last_test_message" {
    null = true
    type = text
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "container_registries_credential_template_id_fkey" {
    columns     = [column.credential_template_id]
    ref_columns = [table.cloud_credential_templates.column.id]
    on_update   = NO_ACTION
    on_delete   = SET_NULL
  }
  index "ix_container_registries_id" {
    columns = [column.id]
  }
  index "ix_container_registries_name" {
    unique  = true
    columns = [column.name]
  }
}
table "deployment_logs" {
  schema = schema.public
  column "id" {
    null = false
    type = serial
  }
  column "module_id" {
    null = false
    type = integer
  }
  column "timestamp" {
    null    = false
    type    = timestamptz
    default = sql("now()")
  }
  column "level" {
    null = false
    type = character_varying(20)
  }
  column "message" {
    null = false
    type = text
  }
  column "created_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "deployment_logs_module_id_fkey" {
    columns     = [column.module_id]
    ref_columns = [table.project_modules.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  index "idx_deployment_logs_level" {
    columns = [column.level]
  }
  index "idx_deployment_logs_module_id" {
    columns = [column.module_id]
  }
  index "idx_deployment_logs_timestamp" {
    columns = [column.timestamp]
  }
  index "ix_deployment_logs_id" {
    columns = [column.id]
  }
  index "ix_deployment_logs_level" {
    columns = [column.level]
  }
  index "ix_deployment_logs_timestamp" {
    columns = [column.timestamp]
  }
}
table "deployments" {
  schema = schema.public
  column "id" {
    null = false
    type = serial
  }
  column "module_id" {
    null = false
    type = integer
  }
  column "action" {
    null = false
    type = character_varying(50)
  }
  column "status" {
    null = false
    type = character_varying(50)
  }
  column "triggered_by" {
    null = true
    type = character_varying(255)
  }
  column "started_at" {
    null    = false
    type    = timestamptz
    default = sql("now()")
  }
  column "completed_at" {
    null = true
    type = timestamptz
  }
  column "duration_seconds" {
    null = true
    type = double_precision
  }
  column "command" {
    null = true
    type = text
  }
  column "exit_code" {
    null = true
    type = integer
  }
  column "stdout" {
    null = true
    type = text
  }
  column "stderr" {
    null = true
    type = text
  }
  column "resources_to_add" {
    null = true
    type = integer
  }
  column "resources_to_change" {
    null = true
    type = integer
  }
  column "resources_to_destroy" {
    null = true
    type = integer
  }
  column "plan_file_path" {
    null = true
    type = character_varying(1000)
  }
  column "git_commit" {
    null = true
    type = character_varying(64)
  }
  column "git_branch" {
    null = true
    type = character_varying(255)
  }
  column "environment" {
    null = true
    type = character_varying(100)
  }
  column "tags" {
    null = true
    type = json
  }
  column "meta_data" {
    null = true
    type = json
  }
  column "created_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  column "updated_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "deployments_module_id_fkey" {
    columns     = [column.module_id]
    ref_columns = [table.project_modules.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  index "idx_deployment_action_status" {
    columns = [column.action, column.status]
  }
  index "idx_deployment_module_status" {
    columns = [column.module_id, column.status]
  }
  index "idx_deployment_started" {
    columns = [column.started_at]
  }
  index "ix_deployments_action" {
    columns = [column.action]
  }
  index "ix_deployments_id" {
    columns = [column.id]
  }
  index "ix_deployments_module_id" {
    columns = [column.module_id]
  }
  index "ix_deployments_status" {
    columns = [column.status]
  }
}
table "discovered_nodes" {
  schema = schema.public
  column "id" {
    null = false
    type = serial
  }
  column "discovery_job_id" {
    null = false
    type = integer
  }
  column "ip_address" {
    null = false
    type = character_varying(255)
  }
  column "hostname" {
    null = true
    type = character_varying(255)
  }
  column "ssh_credential_id" {
    null = true
    type = integer
  }
  column "ssh_username" {
    null = true
    type = character_varying(255)
  }
  column "ssh_port" {
    null = true
    type = integer
  }
  column "ssh_auth_type" {
    null = true
    type = character_varying(50)
  }
  column "ssh_password_encrypted" {
    null = true
    type = text
  }
  column "ssh_key_encrypted" {
    null = true
    type = text
  }
  column "status" {
    null = false
    type = character_varying(50)
  }
  column "error_message" {
    null = true
    type = text
  }
  column "os_type" {
    null = true
    type = character_varying(100)
  }
  column "os_version" {
    null = true
    type = character_varying(100)
  }
  column "os_pretty_name" {
    null = true
    type = character_varying(255)
  }
  column "kernel_version" {
    null = true
    type = character_varying(100)
  }
  column "architecture" {
    null = true
    type = character_varying(50)
  }
  column "is_dpu_host" {
    null = true
    type = boolean
  }
  column "is_dpu_node" {
    null = true
    type = boolean
  }
  column "dpu_count" {
    null = true
    type = integer
  }
  column "dpu_details" {
    null = true
    type = json
  }
  column "is_dpu_bmc" {
    null = true
    type = boolean
  }
  column "bmc_product" {
    null = true
    type = character_varying(255)
  }
  column "bmc_serial_number" {
    null = true
    type = character_varying(255)
  }
  column "bmc_redfish_payload" {
    null = true
    type = json
  }
  column "k8s_installed" {
    null = true
    type = boolean
  }
  column "k8s_running" {
    null = true
    type = boolean
  }
  column "k8s_version" {
    null = true
    type = character_varying(100)
  }
  column "k8s_distribution" {
    null = true
    type = character_varying(100)
  }
  column "k8s_role" {
    null = true
    type = character_varying(50)
  }
  column "container_runtime" {
    null = true
    type = character_varying(100)
  }
  column "network_interfaces" {
    null = true
    type = json
  }
  column "discovery_log" {
    null = true
    type = text
  }
  column "discovered_at" {
    null = true
    type = timestamptz
  }
  column "created_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "discovered_nodes_discovery_job_id_fkey" {
    columns     = [column.discovery_job_id]
    ref_columns = [table.discovery_jobs.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  foreign_key "discovered_nodes_ssh_credential_id_fkey" {
    columns     = [column.ssh_credential_id]
    ref_columns = [table.ssh_credentials.column.id]
    on_update   = NO_ACTION
    on_delete   = SET_NULL
  }
  index "idx_discovered_node_job_ip" {
    unique  = true
    columns = [column.discovery_job_id, column.ip_address]
  }
  index "ix_discovered_nodes_discovery_job_id" {
    columns = [column.discovery_job_id]
  }
  index "ix_discovered_nodes_id" {
    columns = [column.id]
  }
  index "ix_discovered_nodes_status" {
    columns = [column.status]
  }
}
table "discovery_jobs" {
  schema = schema.public
  column "id" {
    null = false
    type = serial
  }
  column "project_id" {
    null = false
    type = integer
  }
  column "ssh_credential_id" {
    null = true
    type = integer
  }
  column "ssh_username" {
    null = true
    type = character_varying(255)
  }
  column "ssh_port" {
    null = true
    type = integer
  }
  column "ssh_auth_type" {
    null = true
    type = character_varying(50)
  }
  column "ssh_password_encrypted" {
    null = true
    type = text
  }
  column "ssh_key_encrypted" {
    null = true
    type = text
  }
  column "status" {
    null = false
    type = character_varying(50)
  }
  column "total_nodes" {
    null = true
    type = integer
  }
  column "completed_nodes" {
    null = true
    type = integer
  }
  column "failed_nodes" {
    null = true
    type = integer
  }
  column "celery_task_id" {
    null = true
    type = character_varying(255)
  }
  column "error_message" {
    null = true
    type = text
  }
  column "started_at" {
    null = true
    type = timestamptz
  }
  column "completed_at" {
    null = true
    type = timestamptz
  }
  column "created_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  column "created_by" {
    null = true
    type = character_varying(255)
  }
  column "connectivity_status" {
    null = true
    type = character_varying(50)
  }
  column "connectivity_matrix" {
    null = true
    type = json
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "discovery_jobs_project_id_fkey" {
    columns     = [column.project_id]
    ref_columns = [table.projects.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  foreign_key "discovery_jobs_ssh_credential_id_fkey" {
    columns     = [column.ssh_credential_id]
    ref_columns = [table.ssh_credentials.column.id]
    on_update   = NO_ACTION
    on_delete   = SET_NULL
  }
  index "idx_discovery_job_project_status" {
    columns = [column.project_id, column.status]
  }
  index "ix_discovery_jobs_celery_task_id" {
    columns = [column.celery_task_id]
  }
  index "ix_discovery_jobs_id" {
    columns = [column.id]
  }
  index "ix_discovery_jobs_project_id" {
    columns = [column.project_id]
  }
  index "ix_discovery_jobs_status" {
    columns = [column.status]
  }
}
table "dpus" {
  schema = schema.public
  column "id" {
    null = false
    type = serial
  }
  column "project_id" {
    null = false
    type = integer
  }
  column "name" {
    null = true
    type = character_varying(255)
  }
  column "access_mode" {
    null = false
    type = character_varying(16)
  }
  column "bmc_ip" {
    null = true
    type = character_varying(255)
  }
  column "bmc_username_encrypted" {
    null = true
    type = text
  }
  column "bmc_password_encrypted" {
    null = true
    type = text
  }
  column "host_node_ip" {
    null = true
    type = character_varying(255)
  }
  column "host_hostname" {
    null = true
    type = character_varying(255)
  }
  column "host_ssh_credential_id" {
    null = true
    type = integer
  }
  column "host_ssh_username" {
    null = true
    type = character_varying(255)
  }
  column "host_ssh_port" {
    null = true
    type = integer
  }
  column "host_ssh_auth_type" {
    null = true
    type = character_varying(16)
  }
  column "host_ssh_password_encrypted" {
    null = true
    type = text
  }
  column "host_ssh_private_key_encrypted" {
    null = true
    type = text
  }
  column "host_ssh_key_passphrase_encrypted" {
    null = true
    type = text
  }
  column "pci_address" {
    null = true
    type = character_varying(32)
  }
  column "rshim_device" {
    null = true
    type = character_varying(16)
  }
  column "serial_number" {
    null = true
    type = character_varying(255)
  }
  column "oob0_mac" {
    null = true
    type = character_varying(32)
  }
  column "oob0_ipv4" {
    null = false
    type = character_varying(64)
  }
  column "external_vlan_id" {
    null = true
    type = integer
  }
  column "external_vlan_ipv4" {
    null = true
    type = character_varying(64)
  }
  column "external_vlan_ipv6" {
    null = true
    type = character_varying(128)
  }
  column "internal_vlan_id" {
    null = true
    type = integer
  }
  column "internal_vlan_ipv4" {
    null = true
    type = character_varying(64)
  }
  column "internal_vlan_ipv6" {
    null = true
    type = character_varying(128)
  }
  column "extra_vlan_interfaces" {
    null = false
    type = json
  }
  column "last_discovery_at" {
    null = true
    type = timestamptz
  }
  column "last_discovery_status" {
    null = true
    type = character_varying(50)
  }
  column "last_discovery_error" {
    null = true
    type = text
  }
  column "last_discovery_payload" {
    null = true
    type = json
  }
  column "dpu_os_ip" {
    null = true
    type = character_varying(255)
  }
  column "dpu_os_reachable" {
    null = true
    type = boolean
  }
  column "dpu_os_status" {
    null = true
    type = character_varying(32)
  }
  column "flash_status" {
    null = true
    type = character_varying(32)
  }
  column "flash_stage_detail" {
    null = true
    type = character_varying(255)
  }
  column "flash_started_at" {
    null = true
    type = timestamptz
  }
  column "flash_completed_at" {
    null = true
    type = timestamptz
  }
  column "flash_error" {
    null = true
    type = text
  }
  column "flash_celery_task_id" {
    null = true
    type = character_varying(64)
  }
  column "last_rendered_bf_conf" {
    null = true
    type = text
  }
  column "last_rendered_bf_conf_at" {
    null = true
    type = timestamptz
  }
  column "rshim_state" {
    null = true
    type = character_varying(32)
  }
  column "rshim_state_detail" {
    null = true
    type = text
  }
  column "rshim_checked_at" {
    null = true
    type = timestamptz
  }
  column "doca_status" {
    null = true
    type = json
  }
  column "created_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  column "updated_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  column "kubernetes_cluster_id" {
    null = true
    type = integer
  }
  column "host_tmfifo_ip" {
    null = true
    type = character_varying(64)
  }
  column "dpu_tmfifo_ip" {
    null = true
    type = character_varying(64)
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "dpus_host_ssh_credential_id_fkey" {
    columns     = [column.host_ssh_credential_id]
    ref_columns = [table.ssh_credentials.column.id]
    on_update   = NO_ACTION
    on_delete   = SET_NULL
  }
  foreign_key "dpus_kubernetes_cluster_id_fkey" {
    columns     = [column.kubernetes_cluster_id]
    ref_columns = [table.kubernetes_clusters.column.id]
    on_update   = NO_ACTION
    on_delete   = SET_NULL
  }
  foreign_key "dpus_project_id_fkey" {
    columns     = [column.project_id]
    ref_columns = [table.projects.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  index "idx_dpu_project_bmc_ip" {
    unique  = true
    columns = [column.project_id, column.bmc_ip]
    where   = "(bmc_ip IS NOT NULL)"
  }
  index "idx_dpu_project_inband" {
    unique  = true
    columns = [column.project_id, column.host_node_ip, column.pci_address]
    where   = "((access_mode)::text = 'in-band'::text)"
  }
  index "ix_dpus_cluster_tmfifo_ip" {
    unique  = true
    columns = [column.kubernetes_cluster_id, column.dpu_tmfifo_ip]
    where   = "(dpu_tmfifo_ip IS NOT NULL)"
  }
  index "ix_dpus_id" {
    columns = [column.id]
  }
  index "ix_dpus_kubernetes_cluster_id" {
    columns = [column.kubernetes_cluster_id]
  }
  index "ix_dpus_project_id" {
    columns = [column.project_id]
  }
}
table "drift_checks" {
  schema = schema.public
  column "id" {
    null = false
    type = serial
  }
  column "project_id" {
    null = false
    type = integer
  }
  column "module_id" {
    null = true
    type = integer
  }
  column "schedule_enabled" {
    null = true
    type = boolean
  }
  column "schedule_cron" {
    null = true
    type = character_varying(100)
  }
  column "last_check_at" {
    null = true
    type = timestamptz
  }
  column "next_check_at" {
    null = true
    type = timestamptz
  }
  column "drift_detected" {
    null = true
    type = boolean
  }
  column "drift_summary" {
    null = true
    type = text
  }
  column "drift_details" {
    null = true
    type = json
  }
  column "task_id" {
    null = true
    type = integer
  }
  column "status" {
    null = true
    type = character_varying(50)
  }
  column "error_message" {
    null = true
    type = text
  }
  column "created_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  column "updated_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "drift_checks_module_id_fkey" {
    columns     = [column.module_id]
    ref_columns = [table.project_modules.column.id]
    on_update   = NO_ACTION
    on_delete   = SET_NULL
  }
  foreign_key "drift_checks_project_id_fkey" {
    columns     = [column.project_id]
    ref_columns = [table.projects.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  foreign_key "drift_checks_task_id_fkey" {
    columns     = [column.task_id]
    ref_columns = [table.tasks.column.id]
    on_update   = NO_ACTION
    on_delete   = NO_ACTION
  }
  index "idx_drift_detected" {
    columns = [column.drift_detected, column.created_at]
  }
  index "idx_drift_next_check" {
    columns = [column.next_check_at]
  }
  index "idx_drift_project_module" {
    columns = [column.project_id, column.module_id]
  }
  index "ix_drift_checks_created_at" {
    columns = [column.created_at]
  }
  index "ix_drift_checks_drift_detected" {
    columns = [column.drift_detected]
  }
  index "ix_drift_checks_id" {
    columns = [column.id]
  }
  index "ix_drift_checks_module_id" {
    columns = [column.module_id]
  }
  index "ix_drift_checks_project_id" {
    columns = [column.project_id]
  }
  index "ix_drift_checks_status" {
    columns = [column.status]
  }
}
table "drift_settings" {
  schema = schema.public
  column "id" {
    null = false
    type = serial
  }
  column "project_id" {
    null = true
    type = integer
  }
  column "enabled" {
    null = true
    type = boolean
  }
  column "schedule_type" {
    null = true
    type = character_varying(50)
  }
  column "schedule_value" {
    null = true
    type = character_varying(100)
  }
  column "notify_on_drift" {
    null = true
    type = boolean
  }
  column "notification_channels" {
    null = true
    type = json
  }
  column "notification_config" {
    null = true
    type = json
  }
  column "check_all_modules" {
    null = true
    type = boolean
  }
  column "module_ids" {
    null = true
    type = json
  }
  column "ignore_insignificant_changes" {
    null = true
    type = boolean
  }
  column "ignore_patterns" {
    null = true
    type = json
  }
  column "created_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  column "updated_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "drift_settings_project_id_fkey" {
    columns     = [column.project_id]
    ref_columns = [table.projects.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  index "idx_drift_settings_enabled" {
    columns = [column.enabled]
  }
  index "ix_drift_settings_enabled" {
    columns = [column.enabled]
  }
  index "ix_drift_settings_id" {
    columns = [column.id]
  }
  index "ix_drift_settings_project_id" {
    columns = [column.project_id]
  }
}
table "egress_configurations" {
  schema = schema.public
  column "id" {
    null = false
    type = serial
  }
  column "cluster_id" {
    null = false
    type = integer
  }
  column "name" {
    null = false
    type = character_varying(255)
  }
  column "namespace" {
    null = false
    type = character_varying(255)
  }
  column "gateway_ref" {
    null = true
    type = character_varying(255)
  }
  column "snat_pool_ref" {
    null = true
    type = character_varying(255)
  }
  column "routes" {
    null = true
    type = json
  }
  column "status" {
    null = true
    type = character_varying(50)
  }
  column "annotations" {
    null = true
    type = json
  }
  column "labels" {
    null = true
    type = json
  }
  column "created_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  column "updated_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "egress_configurations_cluster_id_fkey" {
    columns     = [column.cluster_id]
    ref_columns = [table.kubernetes_clusters.column.id]
    on_update   = NO_ACTION
    on_delete   = NO_ACTION
  }
  index "idx_egress_cluster_namespace" {
    columns = [column.cluster_id, column.namespace]
  }
  index "ix_egress_configurations_id" {
    columns = [column.id]
  }
  index "ix_egress_configurations_name" {
    columns = [column.name]
  }
  index "ix_egress_configurations_namespace" {
    columns = [column.namespace]
  }
}
table "environments" {
  schema = schema.public
  column "id" {
    null = false
    type = serial
  }
  column "project_id" {
    null = false
    type = integer
  }
  column "name" {
    null = false
    type = character_varying(50)
  }
  column "description" {
    null = true
    type = text
  }
  column "is_default" {
    null = true
    type = boolean
  }
  column "cloud_provider" {
    null = true
    type = character_varying(50)
  }
  column "aws_access_key_id" {
    null = true
    type = text
  }
  column "aws_secret_access_key_encrypted" {
    null = true
    type = text
  }
  column "region" {
    null = true
    type = character_varying(50)
  }
  column "gcp_credentials_json_encrypted" {
    null = true
    type = text
  }
  column "gcp_project_id" {
    null = true
    type = character_varying(255)
  }
  column "azure_subscription_id" {
    null = true
    type = character_varying(255)
  }
  column "azure_credentials_json_encrypted" {
    null = true
    type = text
  }
  column "variables_json" {
    null = true
    type = text
  }
  column "tags_json" {
    null = true
    type = text
  }
  column "created_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  column "updated_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "environments_project_id_fkey" {
    columns     = [column.project_id]
    ref_columns = [table.projects.column.id]
    on_update   = NO_ACTION
    on_delete   = NO_ACTION
  }
  index "idx_environments_name" {
    unique  = true
    columns = [column.project_id, column.name]
  }
  index "idx_environments_project_id" {
    columns = [column.project_id]
  }
  index "ix_environments_id" {
    columns = [column.id]
  }
  index "ix_environments_name" {
    columns = [column.name]
  }
}
table "f5_bigip_devices" {
  schema = schema.public
  column "id" {
    null = false
    type = serial
  }
  column "project_id" {
    null = false
    type = integer
  }
  column "name" {
    null = false
    type = character_varying(255)
  }
  column "description" {
    null = true
    type = text
  }
  column "mgmt_host" {
    null = false
    type = character_varying(255)
  }
  column "mgmt_port" {
    null = false
    type = integer
  }
  column "mgmt_credential_id" {
    null = true
    type = integer
  }
  column "verify_https_cert" {
    null = false
    type = boolean
  }
  column "device_info" {
    null = true
    type = json
  }
  column "last_discovery_at" {
    null = true
    type = timestamptz
  }
  column "last_discovery_status" {
    null = true
    type = character_varying(32)
  }
  column "last_discovery_error" {
    null = true
    type = text
  }
  column "created_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  column "updated_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  column "created_by" {
    null = true
    type = character_varying(255)
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "f5_bigip_devices_mgmt_credential_id_fkey" {
    columns     = [column.mgmt_credential_id]
    ref_columns = [table.f5_credentials.column.id]
    on_update   = NO_ACTION
    on_delete   = SET_NULL
  }
  foreign_key "f5_bigip_devices_project_id_fkey" {
    columns     = [column.project_id]
    ref_columns = [table.projects.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  index "idx_f5_device_project_name" {
    unique  = true
    columns = [column.project_id, column.name]
  }
  index "ix_f5_bigip_devices_id" {
    columns = [column.id]
  }
}
table "f5_credentials" {
  schema = schema.public
  column "id" {
    null = false
    type = serial
  }
  column "name" {
    null = false
    type = character_varying(255)
  }
  column "auth_type" {
    null = false
    type = character_varying(20)
  }
  column "username" {
    null = true
    type = character_varying(255)
  }
  column "password_encrypted" {
    null = true
    type = text
  }
  column "token_encrypted" {
    null = true
    type = text
  }
  column "is_default" {
    null = true
    type = boolean
  }
  column "created_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  column "updated_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  column "created_by" {
    null = true
    type = character_varying(255)
  }
  column "last_test_status" {
    null = true
    type = character_varying(16)
  }
  column "last_test_at" {
    null = true
    type = timestamptz
  }
  column "last_test_message" {
    null = true
    type = text
  }
  primary_key {
    columns = [column.id]
  }
  index "ix_f5_credentials_id" {
    columns = [column.id]
  }
  index "ix_f5_credentials_name" {
    unique  = true
    columns = [column.name]
  }
}
table "firewall_policies" {
  schema = schema.public
  column "id" {
    null = false
    type = serial
  }
  column "cluster_id" {
    null = false
    type = integer
  }
  column "name" {
    null = false
    type = character_varying(255)
  }
  column "namespace" {
    null = false
    type = character_varying(255)
  }
  column "policy_type" {
    null = true
    type = character_varying(50)
  }
  column "rules" {
    null = true
    type = json
  }
  column "default_action" {
    null = true
    type = character_varying(50)
  }
  column "priority" {
    null = true
    type = integer
  }
  column "target_ref" {
    null = true
    type = json
  }
  column "status" {
    null = true
    type = character_varying(50)
  }
  column "annotations" {
    null = true
    type = json
  }
  column "labels" {
    null = true
    type = json
  }
  column "created_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  column "updated_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "firewall_policies_cluster_id_fkey" {
    columns     = [column.cluster_id]
    ref_columns = [table.kubernetes_clusters.column.id]
    on_update   = NO_ACTION
    on_delete   = NO_ACTION
  }
  index "idx_policy_cluster_namespace" {
    columns = [column.cluster_id, column.namespace]
  }
  index "idx_policy_type" {
    columns = [column.policy_type]
  }
  index "ix_firewall_policies_id" {
    columns = [column.id]
  }
  index "ix_firewall_policies_name" {
    columns = [column.name]
  }
  index "ix_firewall_policies_namespace" {
    columns = [column.namespace]
  }
}
table "fleet_bulk_run_results" {
  schema = schema.public
  column "id" {
    null = false
    type = serial
  }
  column "run_id" {
    null = false
    type = integer
  }
  column "fleet_member_id" {
    null = false
    type = integer
  }
  column "wave_index" {
    null = false
    type = integer
  }
  column "fault_domain" {
    null = true
    type = character_varying(255)
  }
  column "status" {
    null = false
    type = character_varying(50)
  }
  column "detail" {
    null = true
    type = text
  }
  column "started_at" {
    null = true
    type = timestamptz
  }
  column "completed_at" {
    null = true
    type = timestamptz
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "fleet_bulk_run_results_run_id_fkey" {
    columns     = [column.run_id]
    ref_columns = [table.fleet_bulk_runs.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  index "idx_fleet_bulk_run_result_run" {
    columns = [column.run_id]
  }
  index "ix_fleet_bulk_run_results_id" {
    columns = [column.id]
  }
  index "ix_fleet_bulk_run_results_run_id" {
    columns = [column.run_id]
  }
  unique "uq_bulk_run_member" {
    columns = [column.run_id, column.fleet_member_id]
  }
}
table "fleet_bulk_runs" {
  schema = schema.public
  column "id" {
    null = false
    type = serial
  }
  column "decision_id" {
    null = false
    type = integer
  }
  column "project_id" {
    null = true
    type = integer
  }
  column "action" {
    null = false
    type = character_varying(100)
  }
  column "action_params" {
    null = true
    type = json
  }
  column "wave_by" {
    null = false
    type = character_varying(50)
  }
  column "concurrency" {
    null = false
    type = integer
  }
  column "gate_mode" {
    null = false
    type = character_varying(50)
  }
  column "strategy_id" {
    null = true
    type = integer
  }
  column "status" {
    null = false
    type = character_varying(50)
  }
  column "current_wave_index" {
    null = false
    type = integer
  }
  column "total_waves" {
    null = true
    type = integer
  }
  column "celery_task_id" {
    null = true
    type = character_varying(255)
  }
  column "error_message" {
    null = true
    type = text
  }
  column "gate_resumes_at" {
    null = true
    type = timestamptz
  }
  column "created_by" {
    null = true
    type = character_varying(255)
  }
  column "created_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  column "started_at" {
    null = true
    type = timestamptz
  }
  column "completed_at" {
    null = true
    type = timestamptz
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "fleet_bulk_runs_decision_id_fkey" {
    columns     = [column.decision_id]
    ref_columns = [table.fleet_decisions.column.id]
    on_update   = NO_ACTION
    on_delete   = RESTRICT
  }
  foreign_key "fleet_bulk_runs_strategy_id_fkey" {
    columns     = [column.strategy_id]
    ref_columns = [table.fleet_operation_strategies.column.id]
    on_update   = NO_ACTION
    on_delete   = SET_NULL
  }
  index "idx_fleet_bulk_run_decision" {
    columns = [column.decision_id]
  }
  index "idx_fleet_bulk_run_project" {
    columns = [column.project_id]
  }
  index "idx_fleet_bulk_run_status" {
    columns = [column.status]
  }
  index "idx_fleet_bulk_run_strategy" {
    columns = [column.strategy_id]
  }
  index "ix_fleet_bulk_runs_decision_id" {
    columns = [column.decision_id]
  }
  index "ix_fleet_bulk_runs_id" {
    columns = [column.id]
  }
  index "ix_fleet_bulk_runs_project_id" {
    columns = [column.project_id]
  }
  index "ix_fleet_bulk_runs_strategy_id" {
    columns = [column.strategy_id]
  }
}
table "fleet_decisions" {
  schema = schema.public
  column "id" {
    null = false
    type = serial
  }
  column "target_id" {
    null = false
    type = integer
  }
  column "project_id" {
    null = true
    type = integer
  }
  column "selector_snapshot" {
    null = false
    type = json
  }
  column "resolved_member_ids" {
    null = false
    type = json
  }
  column "member_count" {
    null = false
    type = integer
  }
  column "resolved_at" {
    null = false
    type = timestamptz
  }
  column "resolved_by" {
    null = true
    type = character_varying(255)
  }
  column "status" {
    null = false
    type = character_varying(50)
  }
  column "created_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "fleet_decisions_target_id_fkey" {
    columns     = [column.target_id]
    ref_columns = [table.fleet_targets.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  index "idx_fleet_decision_project" {
    columns = [column.project_id]
  }
  index "idx_fleet_decision_status" {
    columns = [column.status]
  }
  index "idx_fleet_decision_target" {
    columns = [column.target_id]
  }
  index "ix_fleet_decisions_id" {
    columns = [column.id]
  }
  index "ix_fleet_decisions_project_id" {
    columns = [column.project_id]
  }
  index "ix_fleet_decisions_target_id" {
    columns = [column.target_id]
  }
}
table "fleet_deployable_configs" {
  schema = schema.public
  column "id" {
    null = false
    type = serial
  }
  column "fleet_id" {
    null = true
    type = integer
  }
  column "name" {
    null = false
    type = character_varying(255)
  }
  column "description" {
    null = true
    type = character_varying(1000)
  }
  column "category" {
    null    = false
    type    = character_varying(100)
    default = "custom"
  }
  column "target_namespace" {
    null = true
    type = character_varying(255)
  }
  column "config_yaml" {
    null = false
    type = text
  }
  column "source_cluster_id" {
    null = true
    type = integer
  }
  column "source_cluster_name" {
    null = true
    type = character_varying(255)
  }
  column "created_by" {
    null = true
    type = character_varying(255)
  }
  column "created_at" {
    null    = false
    type    = timestamptz
    default = sql("now()")
  }
  column "updated_at" {
    null    = false
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "fleet_deployable_configs_fleet_id_fkey" {
    columns     = [column.fleet_id]
    ref_columns = [table.fleet_targets.column.id]
    on_update   = NO_ACTION
    on_delete   = SET_NULL
  }
  foreign_key "fleet_deployable_configs_source_cluster_id_fkey" {
    columns     = [column.source_cluster_id]
    ref_columns = [table.kubernetes_clusters.column.id]
    on_update   = NO_ACTION
    on_delete   = SET_NULL
  }
  index "ix_fleet_deployable_configs_fleet_id" {
    columns = [column.fleet_id]
  }
  index "ix_fleet_deployable_configs_id" {
    columns = [column.id]
  }
}
table "fleet_members" {
  schema = schema.public
  column "id" {
    null = false
    type = serial
  }
  column "project_id" {
    null = true
    type = integer
  }
  column "member_type" {
    null = false
    type = character_varying(32)
  }
  column "member_id" {
    null = false
    type = integer
  }
  column "name" {
    null = false
    type = character_varying(255)
  }
  column "discovered_labels" {
    null = true
    type = json
  }
  column "assigned_labels" {
    null = true
    type = json
  }
  column "fault_domain" {
    null = true
    type = character_varying(255)
  }
  column "health_status" {
    null = true
    type = character_varying(50)
  }
  column "lifecycle_state" {
    null = true
    type = character_varying(50)
  }
  column "last_reconciled_at" {
    null = true
    type = timestamptz
  }
  column "created_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  column "updated_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "fleet_members_project_id_fkey" {
    columns     = [column.project_id]
    ref_columns = [table.projects.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  index "idx_fleet_member_lifecycle" {
    columns = [column.lifecycle_state]
  }
  index "idx_fleet_member_project" {
    columns = [column.project_id]
  }
  index "idx_fleet_member_type" {
    columns = [column.member_type]
  }
  index "ix_fleet_members_lifecycle_state" {
    columns = [column.lifecycle_state]
  }
  index "ix_fleet_members_member_type" {
    columns = [column.member_type]
  }
  index "ix_fleet_members_project_id" {
    columns = [column.project_id]
  }
  unique "uq_fleet_member_type_id" {
    columns = [column.member_type, column.member_id]
  }
}
table "fleet_operation_strategies" {
  schema = schema.public
  column "id" {
    null = false
    type = serial
  }
  column "project_id" {
    null = true
    type = integer
  }
  column "name" {
    null = false
    type = character_varying(255)
  }
  column "description" {
    null = true
    type = text
  }
  column "target_id" {
    null = true
    type = integer
  }
  column "wave_by" {
    null = false
    type = character_varying(100)
  }
  column "max_concurrency_pct" {
    null = false
    type = integer
  }
  column "gate_kind" {
    null = false
    type = character_varying(50)
  }
  column "gate_wait_seconds" {
    null = true
    type = integer
  }
  column "created_by" {
    null = true
    type = character_varying(255)
  }
  column "created_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  column "updated_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  column "deleted_at" {
    null = true
    type = timestamptz
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "fleet_operation_strategies_project_id_fkey" {
    columns     = [column.project_id]
    ref_columns = [table.projects.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  foreign_key "fleet_operation_strategies_target_id_fkey" {
    columns     = [column.target_id]
    ref_columns = [table.fleet_targets.column.id]
    on_update   = NO_ACTION
    on_delete   = SET_NULL
  }
  index "idx_fleet_strategy_deleted" {
    columns = [column.deleted_at]
  }
  index "idx_fleet_strategy_project" {
    columns = [column.project_id]
  }
  index "idx_fleet_strategy_target" {
    columns = [column.target_id]
  }
  index "ix_fleet_operation_strategies_id" {
    columns = [column.id]
  }
  index "ix_fleet_operation_strategies_project_id" {
    columns = [column.project_id]
  }
  index "ix_fleet_operation_strategies_target_id" {
    columns = [column.target_id]
  }
}
table "fleet_policies" {
  schema = schema.public
  column "id" {
    null = false
    type = serial
  }
  column "project_id" {
    null = true
    type = integer
  }
  column "name" {
    null = false
    type = character_varying(255)
  }
  column "target_id" {
    null = false
    type = integer
  }
  column "kind" {
    null = false
    type = character_varying(50)
  }
  column "mode" {
    null = false
    type = character_varying(50)
  }
  column "desired" {
    null = false
    type = json
  }
  column "created_by" {
    null = true
    type = character_varying(255)
  }
  column "created_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  column "updated_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  column "deleted_at" {
    null = true
    type = timestamptz
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "fleet_policies_project_id_fkey" {
    columns     = [column.project_id]
    ref_columns = [table.projects.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  foreign_key "fleet_policies_target_id_fkey" {
    columns     = [column.target_id]
    ref_columns = [table.fleet_targets.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  index "idx_fleet_policy_deleted" {
    columns = [column.deleted_at]
  }
  index "idx_fleet_policy_kind" {
    columns = [column.kind]
  }
  index "idx_fleet_policy_project" {
    columns = [column.project_id]
  }
  index "idx_fleet_policy_target" {
    columns = [column.target_id]
  }
  index "ix_fleet_policies_id" {
    columns = [column.id]
  }
  index "ix_fleet_policies_project_id" {
    columns = [column.project_id]
  }
  index "ix_fleet_policies_target_id" {
    columns = [column.target_id]
  }
}
table "fleet_policy_evaluations" {
  schema = schema.public
  column "id" {
    null = false
    type = serial
  }
  column "policy_id" {
    null = false
    type = integer
  }
  column "project_id" {
    null = true
    type = integer
  }
  column "evaluated_at" {
    null = false
    type = timestamptz
  }
  column "evaluated_by" {
    null = true
    type = character_varying(255)
  }
  column "selector_snapshot" {
    null = true
    type = json
  }
  column "desired_snapshot" {
    null = false
    type = json
  }
  column "compliant_count" {
    null = false
    type = integer
  }
  column "drifted_count" {
    null = false
    type = integer
  }
  column "unknown_count" {
    null = false
    type = integer
  }
  column "total_count" {
    null = false
    type = integer
  }
  column "member_results" {
    null = false
    type = json
  }
  column "enforced_run_id" {
    null = true
    type = integer
  }
  column "mode" {
    null = false
    type = character_varying(50)
  }
  column "detail" {
    null = true
    type = text
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "fleet_policy_evaluations_enforced_run_id_fkey" {
    columns     = [column.enforced_run_id]
    ref_columns = [table.fleet_bulk_runs.column.id]
    on_update   = NO_ACTION
    on_delete   = SET_NULL
  }
  foreign_key "fleet_policy_evaluations_policy_id_fkey" {
    columns     = [column.policy_id]
    ref_columns = [table.fleet_policies.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  index "idx_policy_eval_evaluated_at" {
    columns = [column.evaluated_at]
  }
  index "idx_policy_eval_policy" {
    columns = [column.policy_id]
  }
  index "idx_policy_eval_project" {
    columns = [column.project_id]
  }
  index "ix_fleet_policy_evaluations_id" {
    columns = [column.id]
  }
  index "ix_fleet_policy_evaluations_policy_id" {
    columns = [column.policy_id]
  }
  index "ix_fleet_policy_evaluations_project_id" {
    columns = [column.project_id]
  }
}
table "fleet_targets" {
  schema = schema.public
  column "id" {
    null = false
    type = serial
  }
  column "project_id" {
    null = true
    type = integer
  }
  column "name" {
    null = false
    type = character_varying(255)
  }
  column "description" {
    null = true
    type = text
  }
  column "selector" {
    null = false
    type = json
  }
  column "pinned_member_ids" {
    null = true
    type = json
  }
  column "created_by" {
    null = true
    type = character_varying(255)
  }
  column "created_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  column "updated_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  column "deleted_at" {
    null = true
    type = timestamptz
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "fleet_targets_project_id_fkey" {
    columns     = [column.project_id]
    ref_columns = [table.projects.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  index "idx_fleet_target_deleted" {
    columns = [column.deleted_at]
  }
  index "idx_fleet_target_project" {
    columns = [column.project_id]
  }
  index "ix_fleet_targets_id" {
    columns = [column.id]
  }
  index "ix_fleet_targets_project_id" {
    columns = [column.project_id]
  }
}
table "helm_charts" {
  schema = schema.public
  column "id" {
    null = false
    type = serial
  }
  column "name" {
    null = false
    type = character_varying(255)
  }
  column "version" {
    null = false
    type = character_varying(100)
  }
  column "app_version" {
    null = true
    type = character_varying(100)
  }
  column "description" {
    null = true
    type = text
  }
  column "source_type" {
    null = true
    type = character_varying(50)
  }
  column "source_chart" {
    null = true
    type = character_varying(255)
  }
  column "source_repository" {
    null = true
    type = character_varying(255)
  }
  column "file_path" {
    null = false
    type = character_varying(500)
  }
  column "file_size" {
    null = true
    type = integer
  }
  column "checksum" {
    null = true
    type = character_varying(64)
  }
  column "chart_metadata" {
    null = true
    type = json
  }
  column "uploaded_by" {
    null = true
    type = character_varying(255)
  }
  column "created_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  column "updated_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  index "idx_helm_chart_name_version" {
    unique  = true
    columns = [column.name, column.version]
  }
  index "idx_helm_chart_source" {
    columns = [column.source_type]
  }
  index "ix_helm_charts_created_at" {
    columns = [column.created_at]
  }
  index "ix_helm_charts_id" {
    columns = [column.id]
  }
  index "ix_helm_charts_name" {
    columns = [column.name]
  }
  index "ix_helm_charts_source_type" {
    columns = [column.source_type]
  }
}
table "k8s_gateways" {
  schema = schema.public
  column "id" {
    null = false
    type = serial
  }
  column "cluster_id" {
    null = false
    type = integer
  }
  column "name" {
    null = false
    type = character_varying(255)
  }
  column "namespace" {
    null = false
    type = character_varying(255)
  }
  column "gateway_class" {
    null = true
    type = character_varying(255)
  }
  column "listeners" {
    null = true
    type = json
  }
  column "addresses" {
    null = true
    type = json
  }
  column "status" {
    null = true
    type = character_varying(50)
  }
  column "conditions" {
    null = true
    type = json
  }
  column "annotations" {
    null = true
    type = json
  }
  column "labels" {
    null = true
    type = json
  }
  column "created_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  column "updated_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "k8s_gateways_cluster_id_fkey" {
    columns     = [column.cluster_id]
    ref_columns = [table.kubernetes_clusters.column.id]
    on_update   = NO_ACTION
    on_delete   = NO_ACTION
  }
  index "idx_gateway_cluster_namespace" {
    columns = [column.cluster_id, column.namespace]
  }
  index "ix_k8s_gateways_id" {
    columns = [column.id]
  }
  index "ix_k8s_gateways_name" {
    columns = [column.name]
  }
  index "ix_k8s_gateways_namespace" {
    columns = [column.namespace]
  }
}
table "kubernetes_clusters" {
  schema = schema.public
  column "id" {
    null = false
    type = serial
  }
  column "name" {
    null = false
    type = character_varying(255)
  }
  column "context" {
    null = false
    type = character_varying(255)
  }
  column "api_server" {
    null = true
    type = character_varying(500)
  }
  column "version" {
    null = true
    type = character_varying(50)
  }
  column "status" {
    null = true
    type = character_varying(50)
  }
  column "last_synced_at" {
    null = true
    type = timestamptz
  }
  column "meta_data" {
    null = true
    type = json
  }
  column "project_id" {
    null = true
    type = integer
  }
  column "kubeconfig_encrypted" {
    null = true
    type = text
  }
  column "cloud_provider" {
    null = true
    type = character_varying(50)
  }
  column "region" {
    null = true
    type = character_varying(100)
  }
  column "default_namespace" {
    null = true
    type = character_varying(255)
  }
  column "detected_platform_profile" {
    null = true
    type = character_varying(50)
  }
  column "detected_platform_provider" {
    null = true
    type = character_varying(50)
  }
  column "platform_capabilities" {
    null = true
    type = json
  }
  column "platform_constraints" {
    null = true
    type = json
  }
  column "enabled_prerequisites" {
    null = true
    type = json
  }
  column "discovered_namespaces" {
    null = true
    type = json
  }
  column "ssh_tunnel_enabled" {
    null    = false
    type    = boolean
    default = false
  }
  column "ssh_remote_k8s_host" {
    null = true
    type = character_varying(255)
  }
  column "ssh_remote_k8s_port" {
    null = true
    type = integer
  }
  column "ssh_credential_id" {
    null = true
    type = integer
  }
  column "ssh_host_override" {
    null = true
    type = character_varying(255)
  }
  column "ssh_credential_template_id" {
    null = true
    type = integer
  }
  column "deployable_release_id" {
    null = true
    type = integer
  }
  column "running_release_id" {
    null = true
    type = integer
  }
  column "created_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  column "updated_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  column "account_id" {
    null = true
    type = character_varying(100)
  }
  column "discovery_status" {
    null = true
    type = character_varying(50)
  }
  column "node_count" {
    null = true
    type = integer
  }
  column "connectivity_status" {
    null = true
    type = character_varying(50)
  }
  column "integration_status" {
    null = true
    type = character_varying(50)
  }
  column "zones" {
    null = true
    type = json
  }
  column "access_method" {
    null = true
    type = character_varying(50)
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "kubernetes_clusters_deployable_release_id_fkey" {
    columns     = [column.deployable_release_id]
    ref_columns = [table.bnk_deployable_release.column.id]
    on_update   = NO_ACTION
    on_delete   = SET_NULL
  }
  foreign_key "kubernetes_clusters_project_id_fkey" {
    columns     = [column.project_id]
    ref_columns = [table.projects.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  foreign_key "kubernetes_clusters_running_release_id_fkey" {
    columns     = [column.running_release_id]
    ref_columns = [table.bnk_releases.column.id]
    on_update   = NO_ACTION
    on_delete   = SET_NULL
  }
  foreign_key "kubernetes_clusters_ssh_credential_id_fkey" {
    columns     = [column.ssh_credential_id]
    ref_columns = [table.ssh_credentials.column.id]
    on_update   = NO_ACTION
    on_delete   = SET_NULL
  }
  foreign_key "kubernetes_clusters_ssh_credential_template_id_fkey" {
    columns     = [column.ssh_credential_template_id]
    ref_columns = [table.cloud_credential_templates.column.id]
    on_update   = NO_ACTION
    on_delete   = NO_ACTION
  }
  index "ix_kubernetes_clusters_id" {
    columns = [column.id]
  }
  index "ix_kubernetes_clusters_name" {
    columns = [column.name]
  }
  index "ix_kubernetes_clusters_project_id" {
    columns = [column.project_id]
  }
  unique "uq_kubernetes_clusters_project_name" {
    columns = [column.project_id, column.name]
  }
}
table "module_dependencies" {
  schema = schema.public
  column "module_id" {
    null = false
    type = integer
  }
  column "dependency_id" {
    null = false
    type = integer
  }
  primary_key {
    columns = [column.module_id, column.dependency_id]
  }
  foreign_key "module_dependencies_dependency_id_fkey" {
    columns     = [column.dependency_id]
    ref_columns = [table.project_modules.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  foreign_key "module_dependencies_module_id_fkey" {
    columns     = [column.module_id]
    ref_columns = [table.project_modules.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
}
table "module_library" {
  schema = schema.public
  column "id" {
    null = false
    type = serial
  }
  column "name" {
    null = false
    type = character_varying(255)
  }
  column "category" {
    null = false
    type = character_varying(50)
  }
  column "path" {
    null = true
    type = character_varying(500)
  }
  column "provider" {
    null = true
    type = character_varying(50)
  }
  column "description" {
    null = true
    type = text
  }
  column "git_source" {
    null = false
    type = character_varying(1000)
  }
  column "version" {
    null = true
    type = character_varying(100)
  }
  column "module_source_kind" {
    null = true
    type = character_varying(50)
  }
  column "execution_engine" {
    null = true
    type = character_varying(50)
  }
  column "deploy_model" {
    null = true
    type = character_varying(50)
  }
  column "engine_type" {
    null = true
    type = character_varying(50)
  }
  column "variables_schema" {
    null = true
    type = json
  }
  column "pack_manifest" {
    null = true
    type = json
  }
  column "artifact_references" {
    null = true
    type = json
  }
  column "dependencies" {
    null = true
    type = json
  }
  column "workflow_compatibility" {
    null = true
    type = json
  }
  column "dependencies_metadata" {
    null = true
    type = json
  }
  column "inputs_metadata" {
    null = true
    type = json
  }
  column "outputs_metadata" {
    null = true
    type = json
  }
  column "deployment_order" {
    null = true
    type = integer
  }
  column "is_official" {
    null = true
    type = boolean
  }
  column "is_tested" {
    null = true
    type = boolean
  }
  column "test_status" {
    null = true
    type = character_varying(50)
  }
  column "test_last_run" {
    null = true
    type = timestamptz
  }
  column "test_error" {
    null = true
    type = text
  }
  column "module_source_id" {
    null = true
    type = integer
  }
  column "source_path" {
    null = true
    type = character_varying(255)
  }
  column "source_version" {
    null = true
    type = character_varying(100)
  }
  column "local_path" {
    null = true
    type = character_varying(500)
  }
  column "is_custom" {
    null = true
    type = boolean
  }
  column "latest_version" {
    null = true
    type = character_varying(100)
  }
  column "update_available" {
    null = true
    type = boolean
  }
  column "tarball_sha256" {
    null = true
    type = character_varying(64)
  }
  column "upstream_source_url" {
    null = true
    type = character_varying(1000)
  }
  column "upstream_subpath" {
    null = true
    type = character_varying(500)
  }
  column "metadata_overrides" {
    null = true
    type = json
  }
  column "last_smoke_test_status" {
    null = true
    type = character_varying(20)
  }
  column "last_smoke_test_output" {
    null = true
    type = text
  }
  column "last_smoke_test_at" {
    null = true
    type = timestamptz
  }
  column "content_sha256" {
    null = true
    type = character_varying(64)
  }
  column "is_latest" {
    null    = false
    type    = boolean
    default = true
  }
  column "readme" {
    null = true
    type = text
  }
  column "tags" {
    null = true
    type = json
  }
  column "is_active" {
    null = true
    type = boolean
  }
  column "validation_error" {
    null = true
    type = text
  }
  column "last_synced" {
    null = true
    type = timestamptz
  }
  column "created_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  column "updated_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "module_library_module_source_id_fkey" {
    columns     = [column.module_source_id]
    ref_columns = [table.module_sources.column.id]
    on_update   = NO_ACTION
    on_delete   = SET_NULL
  }
  index "idx_module_category_provider" {
    columns = [column.category, column.provider]
  }
  index "idx_module_library_path" {
    columns = [column.path]
  }
  index "idx_module_library_path_active" {
    columns = [column.path, column.is_active]
  }
  index "idx_module_library_path_latest" {
    columns = [column.path, column.is_latest]
  }
  index "idx_module_official" {
    columns = [column.is_official]
  }
  index "idx_module_tested" {
    columns = [column.is_tested]
  }
  index "ix_module_library_category" {
    columns = [column.category]
  }
  index "ix_module_library_deploy_model" {
    columns = [column.deploy_model]
  }
  index "ix_module_library_engine_type" {
    columns = [column.engine_type]
  }
  index "ix_module_library_execution_engine" {
    columns = [column.execution_engine]
  }
  index "ix_module_library_id" {
    columns = [column.id]
  }
  index "ix_module_library_module_source_id" {
    columns = [column.module_source_id]
  }
  index "ix_module_library_module_source_kind" {
    columns = [column.module_source_kind]
  }
  index "ix_module_library_name" {
    columns = [column.name]
  }
  unique "uq_module_library_source_path_version" {
    columns = [column.module_source_id, column.path, column.version]
  }
}
table "module_snapshots" {
  schema = schema.public
  column "id" {
    null = false
    type = serial
  }
  column "project_module_id" {
    null = false
    type = integer
  }
  column "snapshot_type" {
    null = false
    type = character_varying(50)
  }
  column "description" {
    null = true
    type = text
  }
  column "created_by" {
    null = true
    type = character_varying(255)
  }
  column "variable_overrides" {
    null = true
    type = json
  }
  column "deployment_order" {
    null = true
    type = integer
  }
  column "dependencies" {
    null = true
    type = json
  }
  column "status" {
    null = true
    type = character_varying(50)
  }
  column "terraform_state" {
    null = true
    type = text
  }
  column "terraform_state_serial" {
    null = true
    type = integer
  }
  column "state_checksum" {
    null = true
    type = character_varying(64)
  }
  column "git_commit" {
    null = true
    type = character_varying(64)
  }
  column "module_path" {
    null = true
    type = character_varying(1000)
  }
  column "created_at" {
    null    = false
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "module_snapshots_project_module_id_fkey" {
    columns     = [column.project_module_id]
    ref_columns = [table.project_modules.column.id]
    on_update   = NO_ACTION
    on_delete   = NO_ACTION
  }
  index "idx_snapshot_created" {
    columns = [column.created_at]
  }
  index "idx_snapshot_module_type" {
    columns = [column.project_module_id, column.snapshot_type]
  }
  index "ix_module_snapshots_created_at" {
    columns = [column.created_at]
  }
  index "ix_module_snapshots_id" {
    columns = [column.id]
  }
  index "ix_module_snapshots_snapshot_type" {
    columns = [column.snapshot_type]
  }
}
table "module_sources" {
  schema = schema.public
  column "id" {
    null = false
    type = serial
  }
  column "name" {
    null = false
    type = character_varying(255)
  }
  column "source_type" {
    null = false
    type = character_varying(50)
  }
  column "url" {
    null = false
    type = character_varying(500)
  }
  column "branch" {
    null = true
    type = character_varying(100)
  }
  column "git_ref" {
    null = true
    type = character_varying(100)
  }
  column "auth_type" {
    null = true
    type = character_varying(50)
  }
  column "auth_token_encrypted" {
    null = true
    type = text
  }
  column "credential_type" {
    null = true
    type = character_varying(50)
  }
  column "credential_scope" {
    null = true
    type = character_varying(255)
  }
  column "credential_capabilities" {
    null = true
    type = json
  }
  column "credential_metadata" {
    null = true
    type = json
  }
  column "credential_expires_at" {
    null = true
    type = timestamptz
  }
  column "credential_last_rotated_at" {
    null = true
    type = timestamptz
  }
  column "credential_validation_status" {
    null = true
    type = character_varying(50)
  }
  column "credential_last_validated_at" {
    null = true
    type = timestamptz
  }
  column "credential_validation_error" {
    null = true
    type = text
  }
  column "last_synced_at" {
    null = true
    type = timestamptz
  }
  column "sync_status" {
    null = true
    type = character_varying(50)
  }
  column "sync_error" {
    null = true
    type = text
  }
  column "module_count" {
    null = true
    type = integer
  }
  column "is_active" {
    null = true
    type = boolean
  }
  column "auto_sync" {
    null = true
    type = boolean
  }
  column "sync_interval_hours" {
    null = true
    type = integer
  }
  column "description" {
    null = true
    type = text
  }
  column "created_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  column "updated_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  index "idx_module_source_active" {
    columns = [column.is_active]
  }
  index "idx_module_source_status" {
    columns = [column.sync_status]
  }
  index "idx_module_source_type" {
    columns = [column.source_type]
  }
  index "ix_module_sources_credential_type" {
    columns = [column.credential_type]
  }
  index "ix_module_sources_credential_validation_status" {
    columns = [column.credential_validation_status]
  }
  index "ix_module_sources_id" {
    columns = [column.id]
  }
  index "ix_module_sources_is_active" {
    columns = [column.is_active]
  }
  index "ix_module_sources_name" {
    unique  = true
    columns = [column.name]
  }
  index "ix_module_sources_source_type" {
    columns = [column.source_type]
  }
  index "ix_module_sources_sync_status" {
    columns = [column.sync_status]
  }
}
table "module_state_transitions" {
  schema = schema.public
  column "id" {
    null = false
    type = bigserial
  }
  column "module_id" {
    null = false
    type = integer
  }
  column "from_status" {
    null = false
    type = character_varying(50)
  }
  column "to_status" {
    null = false
    type = character_varying(50)
  }
  column "task_id" {
    null = true
    type = integer
  }
  column "fence_token" {
    null = true
    type = bigint
  }
  column "reason" {
    null = true
    type = character_varying(500)
  }
  column "at" {
    null    = false
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "module_state_transitions_module_id_fkey" {
    columns     = [column.module_id]
    ref_columns = [table.project_modules.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  foreign_key "module_state_transitions_task_id_fkey" {
    columns     = [column.task_id]
    ref_columns = [table.tasks.column.id]
    on_update   = NO_ACTION
    on_delete   = SET_NULL
  }
  index "idx_module_state_transitions_module_at" {
    columns = [column.module_id, column.at]
  }
}
table "notifications" {
  schema = schema.public
  column "id" {
    null = false
    type = serial
  }
  column "user" {
    null = true
    type = character_varying(255)
  }
  column "type" {
    null = false
    type = character_varying(50)
  }
  column "title" {
    null = false
    type = character_varying(255)
  }
  column "message" {
    null = false
    type = text
  }
  column "resource_type" {
    null = true
    type = character_varying(100)
  }
  column "resource_id" {
    null = true
    type = integer
  }
  column "is_read" {
    null = true
    type = boolean
  }
  column "created_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  column "read_at" {
    null = true
    type = timestamptz
  }
  column "severity" {
    null    = false
    type    = character_varying(20)
    default = "info"
  }
  column "category" {
    null    = false
    type    = character_varying(50)
    default = "general"
  }
  column "action_url" {
    null = true
    type = character_varying(512)
  }
  column "dedupe_key" {
    null = true
    type = character_varying(255)
  }
  column "metadata" {
    null = true
    type = json
  }
  primary_key {
    columns = [column.id]
  }
  index "idx_notification_user_dedupe" {
    columns = [column.user, column.dedupe_key]
  }
  index "idx_notification_user_unread" {
    columns = [column.user, column.is_read]
  }
  index "ix_notifications_category" {
    columns = [column.category]
  }
  index "ix_notifications_created_at" {
    columns = [column.created_at]
  }
  index "ix_notifications_dedupe_key" {
    columns = [column.dedupe_key]
  }
  index "ix_notifications_id" {
    columns = [column.id]
  }
  index "ix_notifications_is_read" {
    columns = [column.is_read]
  }
  index "ix_notifications_user" {
    columns = [column.user]
  }
}
table "operator_command_queue" {
  schema = schema.public
  column "id" {
    null = false
    type = serial
  }
  column "command_id" {
    null = false
    type = character_varying(64)
  }
  column "operator_id" {
    null = false
    type = character_varying(64)
  }
  column "action" {
    null = false
    type = character_varying(100)
  }
  column "payload" {
    null = true
    type = json
  }
  column "timeout_seconds" {
    null = false
    type = integer
  }
  column "status" {
    null = false
    type = character_varying(50)
  }
  column "picked_up_at" {
    null = true
    type = timestamptz
  }
  column "result" {
    null = true
    type = json
  }
  column "output_lines" {
    null = true
    type = json
  }
  column "error_message" {
    null = true
    type = character_varying(2000)
  }
  column "created_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  column "completed_at" {
    null = true
    type = timestamptz
  }
  primary_key {
    columns = [column.id]
  }
  index "idx_cmd_queue_operator_status" {
    columns = [column.operator_id, column.status]
  }
  index "ix_operator_command_queue_command_id" {
    unique  = true
    columns = [column.command_id]
  }
  index "ix_operator_command_queue_id" {
    columns = [column.id]
  }
  index "ix_operator_command_queue_operator_id" {
    columns = [column.operator_id]
  }
  index "ix_operator_command_queue_status" {
    columns = [column.status]
  }
}
table "operator_registration_tokens" {
  schema = schema.public
  column "id" {
    null = false
    type = serial
  }
  column "name" {
    null = false
    type = character_varying(255)
  }
  column "token_hash" {
    null = false
    type = character_varying(255)
  }
  column "token_prefix" {
    null = false
    type = character_varying(20)
  }
  column "max_uses" {
    null = true
    type = integer
  }
  column "use_count" {
    null = false
    type = integer
  }
  column "expires_at" {
    null = true
    type = timestamptz
  }
  column "labels" {
    null = true
    type = json
  }
  column "is_active" {
    null = false
    type = boolean
  }
  column "revoked_at" {
    null = true
    type = timestamptz
  }
  column "revoked_by" {
    null = true
    type = character_varying(255)
  }
  column "created_by" {
    null = false
    type = character_varying(255)
  }
  column "created_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  column "last_used_at" {
    null = true
    type = timestamptz
  }
  primary_key {
    columns = [column.id]
  }
  index "idx_op_token_active_expires" {
    columns = [column.is_active, column.expires_at]
  }
  index "ix_operator_registration_tokens_id" {
    columns = [column.id]
  }
  index "ix_operator_registration_tokens_is_active" {
    columns = [column.is_active]
  }
  index "ix_operator_registration_tokens_name" {
    columns = [column.name]
  }
  index "ix_operator_registration_tokens_token_hash" {
    unique  = true
    columns = [column.token_hash]
  }
}
table "project_backend_configs" {
  schema = schema.public
  column "id" {
    null = false
    type = serial
  }
  column "project_id" {
    null = false
    type = integer
  }
  column "s3_state_bucket" {
    null = true
    type = character_varying(255)
  }
  column "s3_state_key_prefix" {
    null = true
    type = character_varying(255)
  }
  column "s3_state_region" {
    null = true
    type = character_varying(50)
  }
  column "s3_use_native_locking" {
    null = true
    type = boolean
  }
  column "s3_dynamodb_table" {
    null = true
    type = character_varying(255)
  }
  column "state_storage_provider" {
    null = true
    type = character_varying(50)
  }
  column "s3_endpoint" {
    null = true
    type = character_varying(500)
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "project_backend_configs_project_id_fkey" {
    columns     = [column.project_id]
    ref_columns = [table.projects.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  index "ix_project_backend_configs_id" {
    columns = [column.id]
  }
  unique "project_backend_configs_project_id_key" {
    columns = [column.project_id]
  }
}
table "project_cloud_configs" {
  schema = schema.public
  column "id" {
    null = false
    type = serial
  }
  column "project_id" {
    null = false
    type = integer
  }
  column "cloud_sync_enabled" {
    null = true
    type = boolean
  }
  column "cloud_sync_interval_seconds" {
    null = true
    type = integer
  }
  column "cloud_credentials_encrypted" {
    null = true
    type = text
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "project_cloud_configs_project_id_fkey" {
    columns     = [column.project_id]
    ref_columns = [table.projects.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  index "ix_project_cloud_configs_id" {
    columns = [column.id]
  }
  unique "project_cloud_configs_project_id_key" {
    columns = [column.project_id]
  }
}
table "project_dpu_settings" {
  schema = schema.public
  column "id" {
    null = false
    type = serial
  }
  column "project_id" {
    null = false
    type = integer
  }
  column "bluefield_image_id" {
    null = true
    type = integer
  }
  column "bf_template_id" {
    null = true
    type = integer
  }
  column "high_speed_mtu" {
    null = true
    type = integer
  }
  column "dns_servers" {
    null = true
    type = json
  }
  column "ntp_servers" {
    null = true
    type = json
  }
  column "default_oob_username" {
    null = true
    type = character_varying(255)
  }
  column "default_oob_password_encrypted" {
    null = true
    type = text
  }
  column "default_os_username" {
    null = true
    type = character_varying(255)
  }
  column "default_os_password_encrypted" {
    null = true
    type = text
  }
  column "default_os_ssh_credential_id" {
    null = true
    type = integer
  }
  column "external_vlan_id" {
    null = true
    type = integer
  }
  column "external_vlan_ipv4_subnet" {
    null = true
    type = character_varying(64)
  }
  column "external_vlan_ipv6_subnet" {
    null = true
    type = character_varying(128)
  }
  column "external_vlan_start_host" {
    null = true
    type = integer
  }
  column "external_vlan_uplink" {
    null = true
    type = character_varying(16)
  }
  column "internal_vlan_id" {
    null = true
    type = integer
  }
  column "internal_vlan_ipv4_subnet" {
    null = true
    type = character_varying(64)
  }
  column "internal_vlan_ipv6_subnet" {
    null = true
    type = character_varying(128)
  }
  column "internal_vlan_start_host" {
    null = true
    type = integer
  }
  column "internal_vlan_uplink" {
    null = true
    type = character_varying(16)
  }
  column "extra_vlan_interfaces" {
    null = false
    type = json
  }
  column "dpu_connectivity_matrix" {
    null = true
    type = json
  }
  column "dpu_connectivity_status" {
    null = true
    type = character_varying(32)
  }
  column "dpu_connectivity_run_at" {
    null = true
    type = timestamptz
  }
  column "created_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  column "updated_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "project_dpu_settings_bf_template_id_fkey" {
    columns     = [column.bf_template_id]
    ref_columns = [table.bf_conf_templates.column.id]
    on_update   = NO_ACTION
    on_delete   = SET_NULL
  }
  foreign_key "project_dpu_settings_bluefield_image_id_fkey" {
    columns     = [column.bluefield_image_id]
    ref_columns = [table.bluefield_software_images.column.id]
    on_update   = NO_ACTION
    on_delete   = SET_NULL
  }
  foreign_key "project_dpu_settings_default_os_ssh_credential_id_fkey" {
    columns     = [column.default_os_ssh_credential_id]
    ref_columns = [table.ssh_credentials.column.id]
    on_update   = NO_ACTION
    on_delete   = SET_NULL
  }
  foreign_key "project_dpu_settings_project_id_fkey" {
    columns     = [column.project_id]
    ref_columns = [table.projects.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  index "ix_project_dpu_settings_id" {
    columns = [column.id]
  }
  index "ix_project_dpu_settings_project_id" {
    unique  = true
    columns = [column.project_id]
  }
}
table "project_encryption_configs" {
  schema = schema.public
  column "id" {
    null = false
    type = serial
  }
  column "project_id" {
    null = false
    type = integer
  }
  column "state_encryption_enabled" {
    null = true
    type = boolean
  }
  column "encryption_provider" {
    null = true
    type = character_varying(50)
  }
  column "encryption_passphrase_encrypted" {
    null = true
    type = text
  }
  column "encryption_kms_key_id" {
    null = true
    type = character_varying(500)
  }
  column "encryption_kms_region" {
    null = true
    type = character_varying(50)
  }
  column "encryption_vault_url" {
    null = true
    type = character_varying(500)
  }
  column "encryption_vault_key_name" {
    null = true
    type = character_varying(255)
  }
  column "encryption_openbao_address" {
    null = true
    type = character_varying(500)
  }
  column "encryption_openbao_token_encrypted" {
    null = true
    type = text
  }
  column "encryption_openbao_transit_key" {
    null = true
    type = character_varying(255)
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "project_encryption_configs_project_id_fkey" {
    columns     = [column.project_id]
    ref_columns = [table.projects.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  index "ix_project_encryption_configs_id" {
    columns = [column.id]
  }
  unique "project_encryption_configs_project_id_key" {
    columns = [column.project_id]
  }
}
table "project_infra_configs" {
  schema = schema.public
  column "id" {
    null = false
    type = serial
  }
  column "project_id" {
    null = false
    type = integer
  }
  column "infra_enabled" {
    null = true
    type = boolean
  }
  column "infra_host" {
    null = true
    type = character_varying(500)
  }
  column "infra_ssh_port" {
    null = true
    type = integer
  }
  column "infra_ssh_username" {
    null = true
    type = character_varying(255)
  }
  column "infra_ssh_password_encrypted" {
    null = true
    type = character_varying(500)
  }
  column "infra_ssh_key_encrypted" {
    null = true
    type = text
  }
  column "infra_auth_type" {
    null = true
    type = character_varying(20)
  }
  column "infra_os_type" {
    null = true
    type = character_varying(50)
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "project_infra_configs_project_id_fkey" {
    columns     = [column.project_id]
    ref_columns = [table.projects.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  index "ix_project_infra_configs_id" {
    columns = [column.id]
  }
  unique "project_infra_configs_project_id_key" {
    columns = [column.project_id]
  }
}
table "project_modules" {
  schema = schema.public
  column "id" {
    null = false
    type = serial
  }
  column "project_id" {
    null = false
    type = integer
  }
  column "module_library_id" {
    null = false
    type = integer
  }
  column "path_in_project" {
    null = false
    type = character_varying(1000)
  }
  column "variables" {
    null = true
    type = json
  }
  column "variable_overrides" {
    null = true
    type = json
  }
  column "deployment_order" {
    null = true
    type = integer
  }
  column "enabled" {
    null = true
    type = boolean
  }
  column "dependencies" {
    null = true
    type = json
  }
  column "stack_instance_id" {
    null = true
    type = integer
  }
  column "outputs" {
    null = true
    type = json
  }
  column "status" {
    null = true
    type = character_varying(50)
  }
  column "last_deployed_at" {
    null = true
    type = timestamptz
  }
  column "deployment_error" {
    null = true
    type = text
  }
  column "stage_detail" {
    null = true
    type = character_varying(255)
  }
  column "workspace_path" {
    null = true
    type = character_varying(500)
  }
  column "last_init_at" {
    null = true
    type = timestamptz
  }
  column "plan_output" {
    null = true
    type = text
  }
  column "plan_serial" {
    null = true
    type = integer
  }
  column "vars_hash" {
    null = true
    type = character_varying(64)
  }
  column "holding_task_id" {
    null = true
    type = integer
  }
  column "heartbeat_at" {
    null = true
    type = timestamptz
  }
  column "lock_fence_token" {
    null    = false
    type    = bigint
    default = 0
  }
  column "lock_acquired_at" {
    null = true
    type = timestamptz
  }
  column "created_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  column "updated_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "project_modules_module_library_id_fkey" {
    columns     = [column.module_library_id]
    ref_columns = [table.module_library.column.id]
    on_update   = NO_ACTION
    on_delete   = NO_ACTION
  }
  foreign_key "project_modules_project_id_fkey" {
    columns     = [column.project_id]
    ref_columns = [table.projects.column.id]
    on_update   = NO_ACTION
    on_delete   = NO_ACTION
  }
  foreign_key "project_modules_stack_instance_id_fkey" {
    columns     = [column.stack_instance_id]
    ref_columns = [table.stack_instances.column.id]
    on_update   = NO_ACTION
    on_delete   = SET_NULL
  }
  index "idx_project_module_library" {
    columns = [column.module_library_id]
  }
  index "idx_project_module_path" {
    unique  = true
    columns = [column.project_id, column.path_in_project]
  }
  index "idx_project_module_project" {
    columns = [column.project_id]
  }
  index "ix_project_modules_id" {
    columns = [column.id]
  }
  index "ix_project_modules_stack_instance_id" {
    columns = [column.stack_instance_id]
  }
}
table "project_secrets" {
  schema = schema.public
  column "id" {
    null = false
    type = serial
  }
  column "project_id" {
    null = false
    type = integer
  }
  column "name" {
    null = false
    type = character_varying(255)
  }
  column "description" {
    null = true
    type = text
  }
  column "secret_type" {
    null = false
    type = character_varying(20)
  }
  column "filename" {
    null = true
    type = character_varying(255)
  }
  column "file_content_encrypted" {
    null = true
    type = text
  }
  column "file_size" {
    null = true
    type = integer
  }
  column "mime_type" {
    null = true
    type = character_varying(100)
  }
  column "value_encrypted" {
    null = true
    type = text
  }
  column "target_module_path" {
    null = true
    type = character_varying(500)
  }
  column "target_variable_name" {
    null = true
    type = character_varying(255)
  }
  column "is_active" {
    null = true
    type = boolean
  }
  column "last_used_at" {
    null = true
    type = timestamptz
  }
  column "created_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  column "updated_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  column "created_by" {
    null = true
    type = character_varying(255)
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "project_secrets_project_id_fkey" {
    columns     = [column.project_id]
    ref_columns = [table.projects.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  index "idx_project_secret_name" {
    unique  = true
    columns = [column.project_id, column.name]
  }
  index "idx_project_secret_project" {
    columns = [column.project_id]
  }
  index "idx_project_secret_target" {
    columns = [column.project_id, column.target_module_path, column.target_variable_name]
  }
  index "ix_project_secrets_id" {
    columns = [column.id]
  }
  index "ix_project_secrets_project_id" {
    columns = [column.project_id]
  }
}
table "projects" {
  schema = schema.public
  column "id" {
    null = false
    type = serial
  }
  column "name" {
    null = false
    type = character_varying(255)
  }
  column "description" {
    null = true
    type = text
  }
  column "color" {
    null = true
    type = character_varying(20)
  }
  column "icon" {
    null = true
    type = character_varying(50)
  }
  column "is_active" {
    null = true
    type = boolean
  }
  column "module_count" {
    null = true
    type = integer
  }
  column "deployed_count" {
    null = true
    type = integer
  }
  column "failed_count" {
    null = true
    type = integer
  }
  column "owner" {
    null = true
    type = character_varying(255)
  }
  column "team" {
    null = true
    type = character_varying(255)
  }
  column "visibility" {
    null = true
    type = character_varying(50)
  }
  column "user_id" {
    null = true
    type = integer
  }
  column "workflow_type" {
    null = true
    type = character_varying(50)
  }
  column "declared_infrastructure" {
    null = true
    type = json
  }
  column "k8s_context" {
    null = true
    type = character_varying(255)
  }
  column "k8s_sync_enabled" {
    null = true
    type = boolean
  }
  column "k8s_sync_interval_seconds" {
    null = true
    type = integer
  }
  column "target_platform_profile" {
    null = true
    type = character_varying(50)
  }
  column "platform_provider" {
    null = true
    type = character_varying(50)
  }
  column "management_boundary" {
    null = true
    type = character_varying(100)
  }
  column "environment" {
    null = true
    type = character_varying(50)
  }
  column "project_type" {
    null = true
    type = character_varying(50)
  }
  column "cloud_provider" {
    null = true
    type = character_varying(50)
  }
  column "cloud_sync_enabled" {
    null = true
    type = boolean
  }
  column "cloud_sync_interval_seconds" {
    null = true
    type = integer
  }
  column "cloud_credentials_encrypted" {
    null = true
    type = text
  }
  column "credential_template_id" {
    null = true
    type = integer
  }
  column "ssh_credential_id" {
    null = true
    type = integer
  }
  column "backend_type" {
    null = true
    type = character_varying(50)
  }
  column "region" {
    null = true
    type = character_varying(50)
  }
  column "aws_profile" {
    null = true
    type = character_varying(100)
  }
  column "s3_state_bucket" {
    null = true
    type = character_varying(255)
  }
  column "s3_state_key_prefix" {
    null = true
    type = character_varying(255)
  }
  column "s3_state_region" {
    null = true
    type = character_varying(50)
  }
  column "s3_use_native_locking" {
    null = true
    type = boolean
  }
  column "s3_dynamodb_table" {
    null = true
    type = character_varying(255)
  }
  column "state_encryption_enabled" {
    null = true
    type = boolean
  }
  column "encryption_provider" {
    null = true
    type = character_varying(50)
  }
  column "encryption_passphrase_encrypted" {
    null = true
    type = text
  }
  column "encryption_kms_key_id" {
    null = true
    type = character_varying(500)
  }
  column "encryption_kms_region" {
    null = true
    type = character_varying(50)
  }
  column "encryption_vault_url" {
    null = true
    type = character_varying(500)
  }
  column "encryption_vault_key_name" {
    null = true
    type = character_varying(255)
  }
  column "encryption_openbao_address" {
    null = true
    type = character_varying(500)
  }
  column "encryption_openbao_token_encrypted" {
    null = true
    type = text
  }
  column "encryption_openbao_transit_key" {
    null = true
    type = character_varying(255)
  }
  column "infra_enabled" {
    null = true
    type = boolean
  }
  column "infra_host" {
    null = true
    type = character_varying(500)
  }
  column "infra_ssh_port" {
    null = true
    type = integer
  }
  column "infra_ssh_username" {
    null = true
    type = character_varying(255)
  }
  column "infra_ssh_password_encrypted" {
    null = true
    type = character_varying(500)
  }
  column "infra_ssh_key_encrypted" {
    null = true
    type = text
  }
  column "infra_auth_type" {
    null = true
    type = character_varying(20)
  }
  column "infra_os_type" {
    null = true
    type = character_varying(50)
  }
  column "project_variables" {
    null = true
    type = json
  }
  column "dependent_projects" {
    null = true
    type = json
  }
  column "fleet_default_concurrency" {
    null = true
    type = integer
  }
  column "fleet_default_gate_mode" {
    null = true
    type = character_varying(50)
  }
  column "meta_data" {
    null = true
    type = json
  }
  column "created_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  column "updated_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "projects_credential_template_id_fkey" {
    columns     = [column.credential_template_id]
    ref_columns = [table.cloud_credential_templates.column.id]
    on_update   = NO_ACTION
    on_delete   = NO_ACTION
  }
  foreign_key "projects_ssh_credential_id_fkey" {
    columns     = [column.ssh_credential_id]
    ref_columns = [table.ssh_credentials.column.id]
    on_update   = NO_ACTION
    on_delete   = SET_NULL
  }
  foreign_key "projects_user_id_fkey" {
    columns     = [column.user_id]
    ref_columns = [table.users.column.id]
    on_update   = NO_ACTION
    on_delete   = SET_NULL
  }
  index "idx_project_active" {
    columns = [column.is_active]
  }
  index "ix_projects_id" {
    columns = [column.id]
  }
  index "ix_projects_name" {
    unique  = true
    columns = [column.name]
  }
  index "ix_projects_user_id" {
    columns = [column.user_id]
  }
}
table "proxy_deployments" {
  schema = schema.public
  column "id" {
    null = false
    type = serial
  }
  column "target_id" {
    null = false
    type = integer
  }
  column "proxy_type" {
    null = false
    type = character_varying(50)
  }
  column "helm_release" {
    null = true
    type = character_varying(255)
  }
  column "helm_chart" {
    null = true
    type = character_varying(255)
  }
  column "helm_version" {
    null = true
    type = character_varying(50)
  }
  column "helm_values" {
    null = true
    type = json
  }
  column "proxy_url" {
    null = true
    type = character_varying(500)
  }
  column "external_url" {
    null = true
    type = character_varying(500)
  }
  column "status" {
    null = false
    type = character_varying(50)
  }
  column "status_message" {
    null = true
    type = text
  }
  column "deployed_at" {
    null = true
    type = timestamptz
  }
  column "celery_task_id" {
    null = true
    type = character_varying(255)
  }
  column "lock_fence_token" {
    null    = false
    type    = bigint
    default = 0
  }
  column "holding_task_id" {
    null = true
    type = bigint
  }
  column "heartbeat_at" {
    null = true
    type = timestamptz
  }
  column "lock_acquired_at" {
    null = true
    type = timestamptz
  }
  column "created_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  column "updated_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  column "routing_info" {
    null = true
    type = json
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "proxy_deployments_target_id_fkey" {
    columns     = [column.target_id]
    ref_columns = [table.benchmark_targets.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  index "idx_proxy_deployment_status" {
    columns = [column.status]
  }
  index "idx_proxy_deployment_target_type" {
    unique  = true
    columns = [column.target_id, column.proxy_type]
  }
  index "ix_proxy_deployments_id" {
    columns = [column.id]
  }
  index "ix_proxy_deployments_status" {
    columns = [column.status]
  }
  index "ix_proxy_deployments_target_id" {
    columns = [column.target_id]
  }
}
table "proxy_migration_steps" {
  schema = schema.public
  column "id" {
    null = false
    type = serial
  }
  column "migration_id" {
    null = false
    type = integer
  }
  column "step_index" {
    null = false
    type = integer
  }
  column "name" {
    null = false
    type = character_varying(100)
  }
  column "description" {
    null = false
    type = character_varying(255)
  }
  column "status" {
    null = false
    type = character_varying(50)
  }
  column "output_log" {
    null = true
    type = text
  }
  column "result_data" {
    null = true
    type = json
  }
  column "error_message" {
    null = true
    type = text
  }
  column "exit_code" {
    null = true
    type = integer
  }
  column "started_at" {
    null = true
    type = timestamptz
  }
  column "completed_at" {
    null = true
    type = timestamptz
  }
  column "duration_seconds" {
    null = true
    type = double_precision
  }
  column "requires_confirm" {
    null = true
    type = boolean
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "proxy_migration_steps_migration_id_fkey" {
    columns     = [column.migration_id]
    ref_columns = [table.proxy_migrations.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  index "ix_proxy_migration_steps_id" {
    columns = [column.id]
  }
  index "ix_proxy_migration_steps_migration_id" {
    columns = [column.migration_id]
  }
  index "ix_proxy_migration_steps_migration_idx" {
    columns = [column.migration_id, column.step_index]
  }
}
table "proxy_migrations" {
  schema = schema.public
  column "id" {
    null = false
    type = serial
  }
  column "cluster_id" {
    null = false
    type = integer
  }
  column "project_id" {
    null = true
    type = integer
  }
  column "source_descriptor" {
    null = false
    type = json
  }
  column "translated_manifest" {
    null = true
    type = text
  }
  column "bnk_gateway_name" {
    null = true
    type = character_varying(255)
  }
  column "bnk_gateway_namespace" {
    null = true
    type = character_varying(255)
  }
  column "verify_result" {
    null = true
    type = json
  }
  column "teardown_info" {
    null = true
    type = json
  }
  column "status" {
    null = false
    type = character_varying(50)
  }
  column "current_step" {
    null = true
    type = character_varying(50)
  }
  column "error_message" {
    null = true
    type = text
  }
  column "error_step" {
    null = true
    type = character_varying(50)
  }
  column "created_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  column "started_at" {
    null = true
    type = timestamptz
  }
  column "completed_at" {
    null = true
    type = timestamptz
  }
  column "duration_seconds" {
    null = true
    type = double_precision
  }
  column "triggered_by" {
    null = true
    type = character_varying(255)
  }
  column "cutover_confirmed_by" {
    null = true
    type = character_varying(255)
  }
  column "cutover_confirmed_at" {
    null = true
    type = timestamptz
  }
  column "teardown_confirmed_by" {
    null = true
    type = character_varying(255)
  }
  column "teardown_confirmed_at" {
    null = true
    type = timestamptz
  }
  column "celery_task_id" {
    null = true
    type = character_varying(255)
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "proxy_migrations_cluster_id_fkey" {
    columns     = [column.cluster_id]
    ref_columns = [table.kubernetes_clusters.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  foreign_key "proxy_migrations_project_id_fkey" {
    columns     = [column.project_id]
    ref_columns = [table.projects.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  index "ix_proxy_migrations_cluster_id" {
    columns = [column.cluster_id]
  }
  index "ix_proxy_migrations_cluster_status" {
    columns = [column.cluster_id, column.status]
  }
  index "ix_proxy_migrations_id" {
    columns = [column.id]
  }
  index "ix_proxy_migrations_project_id" {
    columns = [column.project_id]
  }
}
table "release_source" {
  schema = schema.public
  column "id" {
    null = false
    type = serial
  }
  column "name" {
    null = false
    type = character_varying(255)
  }
  column "kind" {
    null = false
    type = character_varying(30)
  }
  column "url" {
    null = true
    type = character_varying(500)
  }
  column "credential_encrypted" {
    null = true
    type = text
  }
  column "is_active" {
    null = false
    type = boolean
  }
  column "auto_sync" {
    null = false
    type = boolean
  }
  column "sync_interval_hours" {
    null = true
    type = integer
  }
  column "last_synced_at" {
    null = true
    type = timestamptz
  }
  column "sync_status" {
    null = false
    type = character_varying(50)
  }
  column "sync_error" {
    null = true
    type = text
  }
  column "release_count" {
    null = false
    type = integer
  }
  column "description" {
    null = true
    type = text
  }
  column "created_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  column "updated_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  index "idx_release_source_active" {
    columns = [column.is_active]
  }
  index "idx_release_source_kind" {
    columns = [column.kind]
  }
  index "idx_release_source_sync_status" {
    columns = [column.sync_status]
  }
  index "ix_release_source_id" {
    columns = [column.id]
  }
  index "ix_release_source_name" {
    unique  = true
    columns = [column.name]
  }
}
table "snat_pools" {
  schema = schema.public
  column "id" {
    null = false
    type = serial
  }
  column "cluster_id" {
    null = false
    type = integer
  }
  column "name" {
    null = false
    type = character_varying(255)
  }
  column "namespace" {
    null = false
    type = character_varying(255)
  }
  column "ip_addresses" {
    null = true
    type = json
  }
  column "status" {
    null = true
    type = character_varying(50)
  }
  column "annotations" {
    null = true
    type = json
  }
  column "labels" {
    null = true
    type = json
  }
  column "created_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  column "updated_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "snat_pools_cluster_id_fkey" {
    columns     = [column.cluster_id]
    ref_columns = [table.kubernetes_clusters.column.id]
    on_update   = NO_ACTION
    on_delete   = NO_ACTION
  }
  index "idx_snat_cluster_namespace" {
    columns = [column.cluster_id, column.namespace]
  }
  index "ix_snat_pools_id" {
    columns = [column.id]
  }
  index "ix_snat_pools_name" {
    columns = [column.name]
  }
  index "ix_snat_pools_namespace" {
    columns = [column.namespace]
  }
}
table "ssh_credentials" {
  schema = schema.public
  column "id" {
    null = false
    type = serial
  }
  column "name" {
    null = false
    type = character_varying(255)
  }
  column "description" {
    null = true
    type = text
  }
  column "host" {
    null = false
    type = character_varying(255)
  }
  column "port" {
    null = false
    type = integer
  }
  column "username" {
    null = false
    type = character_varying(255)
  }
  column "auth_type" {
    null = false
    type = character_varying(50)
  }
  column "password_encrypted" {
    null = true
    type = text
  }
  column "private_key_encrypted" {
    null = true
    type = text
  }
  column "key_passphrase_encrypted" {
    null = true
    type = text
  }
  column "is_default" {
    null = true
    type = boolean
  }
  column "created_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  column "updated_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  column "created_by" {
    null = true
    type = character_varying(255)
  }
  column "last_test_status" {
    null = true
    type = character_varying(16)
  }
  column "last_test_at" {
    null = true
    type = timestamptz
  }
  column "last_test_message" {
    null = true
    type = text
  }
  primary_key {
    columns = [column.id]
  }
  index "ix_ssh_credentials_id" {
    columns = [column.id]
  }
  index "ix_ssh_credentials_name" {
    unique  = true
    columns = [column.name]
  }
}
table "stack_instances" {
  schema = schema.public
  column "id" {
    null = false
    type = serial
  }
  column "project_id" {
    null = false
    type = integer
  }
  column "template_id" {
    null = true
    type = integer
  }
  column "blueprint_release_id" {
    null = true
    type = integer
  }
  column "name" {
    null = false
    type = character_varying(255)
  }
  column "status" {
    null = false
    type = character_varying(50)
  }
  column "variables" {
    null = true
    type = json
  }
  column "current_step" {
    null = true
    type = integer
  }
  column "total_steps" {
    null = true
    type = integer
  }
  column "started_at" {
    null = true
    type = timestamptz
  }
  column "completed_at" {
    null = true
    type = timestamptz
  }
  column "error_message" {
    null = true
    type = text
  }
  column "created_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  column "updated_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "stack_instances_blueprint_release_id_fkey" {
    columns     = [column.blueprint_release_id]
    ref_columns = [table.blueprint_releases.column.id]
    on_update   = NO_ACTION
    on_delete   = SET_NULL
  }
  foreign_key "stack_instances_project_id_fkey" {
    columns     = [column.project_id]
    ref_columns = [table.projects.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  foreign_key "stack_instances_template_id_fkey" {
    columns     = [column.template_id]
    ref_columns = [table.stack_templates.column.id]
    on_update   = NO_ACTION
    on_delete   = NO_ACTION
  }
  index "idx_stack_instance_blueprint_release" {
    columns = [column.blueprint_release_id]
  }
  index "idx_stack_instance_project_status" {
    columns = [column.project_id, column.status]
  }
  index "idx_stack_instance_template" {
    columns = [column.template_id]
  }
  index "ix_stack_instances_id" {
    columns = [column.id]
  }
  index "ix_stack_instances_name" {
    columns = [column.name]
  }
  index "ix_stack_instances_project_id" {
    columns = [column.project_id]
  }
  index "ix_stack_instances_status" {
    columns = [column.status]
  }
  index "ix_stack_instances_template_id" {
    columns = [column.template_id]
  }
}
table "stack_templates" {
  schema = schema.public
  column "id" {
    null = false
    type = serial
  }
  column "name" {
    null = false
    type = character_varying(255)
  }
  column "slug" {
    null = false
    type = character_varying(255)
  }
  column "description" {
    null = true
    type = text
  }
  column "category" {
    null = true
    type = character_varying(50)
  }
  column "cloud_provider" {
    null = true
    type = character_varying(50)
  }
  column "icon" {
    null = true
    type = character_varying(50)
  }
  column "color" {
    null = true
    type = character_varying(20)
  }
  column "estimated_time" {
    null = true
    type = character_varying(100)
  }
  column "estimated_cost" {
    null = true
    type = character_varying(100)
  }
  column "difficulty" {
    null = true
    type = character_varying(50)
  }
  column "modules" {
    null = true
    type = json
  }
  column "variable_templates" {
    null = true
    type = json
  }
  column "prerequisites" {
    null = true
    type = json
  }
  column "tags" {
    null = true
    type = json
  }
  column "maturity" {
    null = true
    type = character_varying(50)
  }
  column "outcomes" {
    null = true
    type = json
  }
  column "platform_defaults" {
    null    = true
    type    = json
    comment = "Per-platform variable overrides: {platform_profile: {var: value}}"
  }
  column "bnk_version" {
    null    = true
    type    = character_varying(50)
    comment = "Target BNK version compatibility (e.g. '2.2', '2.1+', null for infra-only)"
  }
  column "version" {
    null = true
    type = character_varying(20)
  }
  column "created_by" {
    null = true
    type = character_varying(50)
  }
  column "is_public" {
    null = true
    type = boolean
  }
  column "forked_from" {
    null = true
    type = integer
  }
  column "is_active" {
    null = true
    type = boolean
  }
  column "is_featured" {
    null = true
    type = boolean
  }
  column "created_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  column "updated_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "stack_templates_forked_from_fkey" {
    columns     = [column.forked_from]
    ref_columns = [table.stack_templates.column.id]
    on_update   = NO_ACTION
    on_delete   = NO_ACTION
  }
  index "idx_stack_template_active_featured" {
    columns = [column.is_active, column.is_featured]
  }
  index "idx_stack_template_category_provider" {
    columns = [column.category, column.cloud_provider]
  }
  index "idx_stack_template_created_by_public" {
    columns = [column.created_by, column.is_public]
  }
  index "ix_stack_templates_category" {
    columns = [column.category]
  }
  index "ix_stack_templates_created_by" {
    columns = [column.created_by]
  }
  index "ix_stack_templates_id" {
    columns = [column.id]
  }
  index "ix_stack_templates_is_active" {
    columns = [column.is_active]
  }
  index "ix_stack_templates_is_featured" {
    columns = [column.is_featured]
  }
  index "ix_stack_templates_is_public" {
    columns = [column.is_public]
  }
  index "ix_stack_templates_name" {
    columns = [column.name]
  }
  index "ix_stack_templates_slug" {
    unique  = true
    columns = [column.slug]
  }
}
table "sync_jobs" {
  schema = schema.public
  column "id" {
    null = false
    type = serial
  }
  column "job_type" {
    null = false
    type = character_varying(100)
  }
  column "resource_type" {
    null = true
    type = character_varying(100)
  }
  column "status" {
    null = false
    type = character_varying(50)
  }
  column "started_at" {
    null    = false
    type    = timestamptz
    default = sql("now()")
  }
  column "completed_at" {
    null = true
    type = timestamptz
  }
  column "duration_seconds" {
    null = true
    type = double_precision
  }
  column "records_synced" {
    null = true
    type = integer
  }
  column "records_created" {
    null = true
    type = integer
  }
  column "records_updated" {
    null = true
    type = integer
  }
  column "records_deleted" {
    null = true
    type = integer
  }
  column "error_message" {
    null = true
    type = text
  }
  column "error_details" {
    null = true
    type = json
  }
  column "meta_data" {
    null = true
    type = json
  }
  column "created_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  index "idx_sync_job_type_status" {
    columns = [column.job_type, column.status]
  }
  index "idx_sync_started_at" {
    columns = [column.started_at]
  }
  index "ix_sync_jobs_id" {
    columns = [column.id]
  }
  index "ix_sync_jobs_job_type" {
    columns = [column.job_type]
  }
}
table "tasks" {
  schema = schema.public
  column "id" {
    null = false
    type = serial
  }
  column "celery_task_id" {
    null = true
    type = character_varying(255)
  }
  column "task_type" {
    null = false
    type = character_varying(50)
  }
  column "status" {
    null = false
    type = character_varying(50)
  }
  column "project_id" {
    null = false
    type = integer
  }
  column "module_id" {
    null = true
    type = integer
  }
  column "created_at" {
    null    = false
    type    = timestamptz
    default = sql("now()")
  }
  column "started_at" {
    null = true
    type = timestamptz
  }
  column "completed_at" {
    null = true
    type = timestamptz
  }
  column "duration_seconds" {
    null = true
    type = double_precision
  }
  column "triggered_by" {
    null = true
    type = character_varying(255)
  }
  column "command" {
    null = true
    type = text
  }
  column "working_directory" {
    null = true
    type = character_varying(1000)
  }
  column "exit_code" {
    null = true
    type = integer
  }
  column "logs" {
    null = true
    type = text
  }
  column "error" {
    null = true
    type = text
  }
  column "meta_data" {
    null = true
    type = json
  }
  column "archived" {
    null    = false
    type    = boolean
    default = false
  }
  column "run_handle" {
    null = true
    type = character_varying(255)
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "tasks_module_id_fkey" {
    columns     = [column.module_id]
    ref_columns = [table.project_modules.column.id]
    on_update   = NO_ACTION
    on_delete   = SET_NULL
  }
  foreign_key "tasks_project_id_fkey" {
    columns     = [column.project_id]
    ref_columns = [table.projects.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  index "idx_task_created" {
    columns = [column.created_at]
  }
  index "idx_task_module_status" {
    columns = [column.module_id, column.status]
  }
  index "idx_task_project_status" {
    columns = [column.project_id, column.status]
  }
  index "idx_task_run_handle" {
    columns = [column.run_handle]
  }
  index "idx_task_type_status" {
    columns = [column.task_type, column.status]
  }
  index "ix_tasks_archived" {
    columns = [column.archived]
  }
  index "ix_tasks_celery_task_id" {
    unique  = true
    columns = [column.celery_task_id]
  }
  index "ix_tasks_created_at" {
    columns = [column.created_at]
  }
  index "ix_tasks_id" {
    columns = [column.id]
  }
  index "ix_tasks_module_id" {
    columns = [column.module_id]
  }
  index "ix_tasks_project_id" {
    columns = [column.project_id]
  }
  index "ix_tasks_started_at" {
    columns = [column.started_at]
  }
  index "ix_tasks_status" {
    columns = [column.status]
  }
  index "ix_tasks_task_type" {
    columns = [column.task_type]
  }
}
table "usecase_applications" {
  schema = schema.public
  column "id" {
    null = false
    type = serial
  }
  column "artifact_version_id" {
    null = false
    type = integer
  }
  column "cluster_id" {
    null = false
    type = integer
  }
  column "param_values" {
    null = false
    type = json
  }
  column "applied_by" {
    null = true
    type = character_varying(255)
  }
  column "applied_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "usecase_applications_artifact_version_id_fkey" {
    columns     = [column.artifact_version_id]
    ref_columns = [table.usecase_artifact_versions.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  foreign_key "usecase_applications_cluster_id_fkey" {
    columns     = [column.cluster_id]
    ref_columns = [table.kubernetes_clusters.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  index "idx_usecase_application_cluster" {
    columns = [column.cluster_id]
  }
  index "idx_usecase_application_version" {
    columns = [column.artifact_version_id]
  }
  index "ix_usecase_applications_id" {
    columns = [column.id]
  }
}
table "usecase_artifact_versions" {
  schema = schema.public
  column "id" {
    null = false
    type = serial
  }
  column "artifact_id" {
    null = false
    type = integer
  }
  column "version" {
    null = false
    type = character_varying(50)
  }
  column "matching_bnk_version" {
    null = true
    type = character_varying(64)
  }
  column "cr_templates" {
    null = false
    type = json
  }
  column "param_schema" {
    null = false
    type = json
  }
  column "source" {
    null = false
    type = character_varying(50)
  }
  column "source_cluster_id" {
    null = true
    type = integer
  }
  column "content_hash" {
    null = false
    type = character_varying(64)
  }
  column "created_by" {
    null = true
    type = character_varying(255)
  }
  column "created_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "usecase_artifact_versions_artifact_id_fkey" {
    columns     = [column.artifact_id]
    ref_columns = [table.usecase_artifacts.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  foreign_key "usecase_artifact_versions_source_cluster_id_fkey" {
    columns     = [column.source_cluster_id]
    ref_columns = [table.kubernetes_clusters.column.id]
    on_update   = NO_ACTION
    on_delete   = SET_NULL
  }
  index "idx_usecase_artifact_version_artifact" {
    columns = [column.artifact_id]
  }
  index "idx_usecase_artifact_version_content_hash" {
    columns = [column.content_hash]
  }
  index "ix_usecase_artifact_versions_content_hash" {
    columns = [column.content_hash]
  }
  index "ix_usecase_artifact_versions_id" {
    columns = [column.id]
  }
  unique "uq_usecase_artifact_version" {
    columns = [column.artifact_id, column.version]
  }
}
table "usecase_artifacts" {
  schema = schema.public
  column "id" {
    null = false
    type = serial
  }
  column "name" {
    null = false
    type = character_varying(255)
  }
  column "description" {
    null = true
    type = text
  }
  column "created_by" {
    null = true
    type = character_varying(255)
  }
  column "created_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  column "updated_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  index "ix_usecase_artifacts_id" {
    columns = [column.id]
  }
  unique "usecase_artifacts_name_key" {
    columns = [column.name]
  }
}
table "users" {
  schema = schema.public
  column "id" {
    null = false
    type = serial
  }
  column "username" {
    null = false
    type = character_varying(255)
  }
  column "email" {
    null = false
    type = character_varying(255)
  }
  column "hashed_password" {
    null = false
    type = character_varying(255)
  }
  column "role" {
    null = false
    type = character_varying(50)
  }
  column "is_active" {
    null = false
    type = boolean
  }
  column "must_change_password" {
    null = false
    type = boolean
  }
  column "is_service_account" {
    null    = false
    type    = boolean
    default = false
  }
  column "last_login_at" {
    null = true
    type = timestamptz
  }
  column "created_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  column "updated_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  index "ix_users_email" {
    unique  = true
    columns = [column.email]
  }
  index "ix_users_id" {
    columns = [column.id]
  }
  index "ix_users_username" {
    unique  = true
    columns = [column.username]
  }
}
table "variable_mapping_templates" {
  schema = schema.public
  column "id" {
    null = false
    type = serial
  }
  column "name" {
    null = false
    type = character_varying(255)
  }
  column "description" {
    null = true
    type = text
  }
  column "mappings" {
    null = false
    type = json
  }
  column "is_public" {
    null = true
    type = boolean
  }
  column "created_by" {
    null = true
    type = character_varying(255)
  }
  column "usage_count" {
    null = true
    type = integer
  }
  column "created_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  column "updated_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  index "idx_variable_template_name" {
    columns = [column.name]
  }
  index "idx_variable_template_public" {
    columns = [column.is_public]
  }
  index "ix_variable_mapping_templates_id" {
    columns = [column.id]
  }
  index "ix_variable_mapping_templates_name" {
    unique  = true
    columns = [column.name]
  }
}
table "variable_mappings" {
  schema = schema.public
  column "id" {
    null = false
    type = serial
  }
  column "project_module_id" {
    null = false
    type = integer
  }
  column "source_variable_name" {
    null = false
    type = character_varying(255)
  }
  column "target_variable_name" {
    null = false
    type = character_varying(255)
  }
  column "transform_type" {
    null = true
    type = character_varying(50)
  }
  column "is_active" {
    null = true
    type = boolean
  }
  column "description" {
    null = true
    type = text
  }
  column "created_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  column "updated_at" {
    null    = true
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "variable_mappings_project_module_id_fkey" {
    columns     = [column.project_module_id]
    ref_columns = [table.project_modules.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  index "idx_variable_mapping_module" {
    columns = [column.project_module_id]
  }
  index "idx_variable_mapping_source" {
    columns = [column.source_variable_name]
  }
  index "idx_variable_mapping_target" {
    columns = [column.target_variable_name]
  }
  index "ix_variable_mappings_id" {
    columns = [column.id]
  }
}
schema "public" {
}
