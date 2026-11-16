/**
 * Fleet Enrollment & Agent Bootstrap API
 * Aligned with Milestone 2 Push-based Edge Architecture (:17543)
 */
import { apiClient } from './client';
import type {
  CreateEnrollmentTokenRequest,
  EnrollmentTokenResponse,
  TokenListItem,
  CaBundleResponse,
} from '@/types/fleetEnrollment';

export const fleetEnrollmentApi = {
  /** Mint a short-lived (24h) JWT enrollment token and generate ready-to-run installation commands. */
  createEnrollmentToken: async (
    req: CreateEnrollmentTokenRequest
  ): Promise<EnrollmentTokenResponse> => {
    const { data } = await apiClient.post<EnrollmentTokenResponse>(
      '/api/fleet/enrollment/token',
      req
    );
    return data;
  },

  /** List active enrollment tokens, optionally filtered by project. */
  listEnrollmentTokens: async (projectId?: number): Promise<TokenListItem[]> => {
    const { data } = await apiClient.get<TokenListItem[]>(
      '/api/fleet/enrollment/tokens',
      {
        params: projectId !== undefined ? { project_id: projectId } : undefined,
      }
    );
    return data;
  },

  /** Revoke an active enrollment token. */
  revokeEnrollmentToken: async (
    tokenId: number
  ): Promise<{ status: string; id: number }> => {
    const { data } = await apiClient.delete<{ status: string; id: number }>(
      `/api/fleet/enrollment/tokens/${tokenId}`
    );
    return data;
  },

  /** Retrieve the Console Root CA certificate bundle. */
  getCaBundle: async (): Promise<CaBundleResponse> => {
    const { data } = await apiClient.get<CaBundleResponse>(
      '/api/fleet/enrollment/ca'
    );
    return data;
  },
};
