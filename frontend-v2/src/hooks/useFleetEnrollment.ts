/**
 * React Query hooks for Fleet Enrollment & Agent Bootstrap.
 * Supports Push-Based Edge Agent enrollment and token lifecycle.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fleetEnrollmentApi } from "@/lib/api/fleetEnrollment";
import { queryKeys } from "@/lib/queryKeys";
import { useAppMutation } from "@/hooks/lib/useAppMutation";
import { notify } from "@/lib/notify";
import type {
  CreateEnrollmentTokenRequest,
  EnrollmentTokenResponse,
  TokenListItem,
  CaBundleResponse,
} from "@/types/fleetEnrollment";

export function useEnrollmentTokens(projectId?: number) {
  return useQuery<TokenListItem[]>({
    queryKey: queryKeys.fleet.enrollmentTokens(projectId),
    queryFn: () => fleetEnrollmentApi.listEnrollmentTokens(projectId),
    staleTime: 10_000,
  });
}

export function useCaBundle() {
  return useQuery<CaBundleResponse>({
    queryKey: queryKeys.fleet.caBundle(),
    queryFn: () => fleetEnrollmentApi.getCaBundle(),
    staleTime: 60 * 60 * 1000, // 1 hour CA bundle cache
  });
}

export function useCreateEnrollmentToken() {
  const queryClient = useQueryClient();

  return useAppMutation<EnrollmentTokenResponse, Error, CreateEnrollmentTokenRequest>({
    mutationFn: (data: CreateEnrollmentTokenRequest) =>
      fleetEnrollmentApi.createEnrollmentToken(data),
    onSuccess: (data) => {
      notify.success(
        "Enrollment Token Generated",
        `Token for cluster '${data.cluster_name}' ready.`
      );
      queryClient.invalidateQueries({
        queryKey: queryKeys.fleet.enrollmentTokens(),
      });
    },
  });
}

export function useRevokeEnrollmentToken() {
  const queryClient = useQueryClient();

  return useAppMutation<{ status: string; id: number }, Error, number>({
    mutationFn: (tokenId: number) =>
      fleetEnrollmentApi.revokeEnrollmentToken(tokenId),
    onSuccess: () => {
      notify.info(
        "Enrollment Token Revoked",
        "The enrollment token has been invalidated."
      );
      queryClient.invalidateQueries({
        queryKey: queryKeys.fleet.enrollmentTokens(),
      });
    },
  });
}
