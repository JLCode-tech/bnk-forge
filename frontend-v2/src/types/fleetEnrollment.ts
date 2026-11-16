/**
 * Fleet Enrollment & Agent Bootstrap Types
 * Aligned with Milestone 2 Push-based Agent Architecture (:17543)
 */

export interface CreateEnrollmentTokenRequest {
  cluster_name: string;
  project_id?: number | null;
  cluster_id?: number | null;
  expires_in_hours?: number;
  max_uses?: number | null;
  labels?: Record<string, unknown>;
}

export interface EnrollmentTokenResponse {
  id: number;
  name: string;
  token_prefix: string;
  token: string;
  cluster_name: string;
  project_id?: number | null;
  expires_at: string;
  max_uses?: number | null;
  helm_command: string;
  kubectl_command: string;
}

export interface TokenListItem {
  id: number;
  name: string;
  token_prefix: string;
  use_count: number;
  max_uses?: number | null;
  expires_at?: string | null;
  is_active: boolean;
  created_by: string;
  created_at?: string | null;
  labels?: Record<string, unknown> | null;
}

export interface BootstrapResponse {
  status: string;
  certificate: string;
  ca_certificate: string;
  cluster_uuid: string;
  spiffe_id: string;
  console_url: string;
  heartbeat_interval_sec: number;
  expires_at: string;
  cluster_id?: number | null;
  cluster_name?: string | null;
}

export interface CaBundleResponse {
  ca_certificate: string;
}
