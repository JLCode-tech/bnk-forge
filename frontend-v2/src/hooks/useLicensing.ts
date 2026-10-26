/**
 * React Query hooks for BNK licensing operations.
 *
 * K8S-UX-010: All licensing operations are dispatched through the connected
 * operator pod → CWC REST API via mTLS.
 */
import { useEffect, useMemo } from "react";
import {
  hashKey,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { licensingApi } from "@/lib/api/licensing";

import type {
  LicenseActivateRequest,
  LicenseRenewRequest,
  LicenseReceiptRequest,
  LicenseInfo,
  LicenseStatusResponse,
  JwksValidationResponse,
} from "@/types";
import { useAppMutation } from "@/hooks/lib/useAppMutation";

export const LICENSING_KEYS = {
  all: ["licensing"] as const,
  status: (clusterId: number) =>
    [...LICENSING_KEYS.all, "status", clusterId] as const,
  report: (clusterId: number) =>
    [...LICENSING_KEYS.all, "report", clusterId] as const,
  cwcStatus: (clusterId: number) =>
    [...LICENSING_KEYS.all, "cwc-status", clusterId] as const,
};

/**
 * Parse the normalized license status response into a friendly LicenseInfo
 * object for the UI.
 *
 * The backend normalizes the varying CWC response shapes into flat fields:
 *   license_state, entitlement_type, digital_asset_id, license_expiry_date,
 *   license_expiry_days, telemetry_state, telemetry_message, error, etc.
 */
function parseLicenseStatus(
  data: LicenseStatusResponse | undefined,
): LicenseInfo {
  if (!data) {
    return { state: "unavailable" };
  }

  const installed = data.installed;
  const readOnly = data.read_only === true ? true : undefined;
  const clientPodRunning = data.client_pod_running;
  const errorMsg =
    data.error ??
    (typeof data.error_message === "string" ? data.error_message : undefined) ??
    undefined;
  const suggestedAction = data.suggested_action ?? undefined;

  if (!data.success || installed === false || clientPodRunning === false) {
    return {
      state: "unavailable",
      installed,
      readOnly,
      clientPodRunning,
      error: errorMsg,
      suggestedAction,
    };
  }

  const licenseState = data.license_state;
  const entitlementType = (data.entitlement_type ?? "").toLowerCase();
  const expiryDays = data.license_expiry_days ?? undefined;

  // If no license state at all, mark as unknown
  if (!licenseState || licenseState === "Unknown") {
    // If there's an error, it's a failed state, not truly unknown
    if (errorMsg) {
      return {
        state: "expired", // Show as a problem state
        installed,
        readOnly,
        clientPodRunning,
        entitlementType: data.entitlement_type ?? undefined,
        digitalAssetId: data.digital_asset_id ?? undefined,
        expiryDate: data.license_expiry_date ?? undefined,
        expiryDays,
        telemetryState: data.telemetry_state ?? undefined,
        telemetryMessage: errorMsg,
        error: errorMsg,
        suggestedAction,
      };
    }
    return {
      state: "unknown",
      installed,
      readOnly,
      clientPodRunning,
    };
  }

  let state: LicenseInfo["state"] = "unknown";
  const lsLower = licenseState.toLowerCase();

  if (
    lsLower === "active" ||
    lsLower === "licensed" ||
    lsLower === "verification complete" ||
    lsLower.includes("active")
  ) {
    state = "active";
  } else if (
    lsLower === "expired" ||
    lsLower.includes("expired") ||
    (expiryDays !== undefined && expiryDays <= 0)
  ) {
    state = "expired";
  } else if (
    lsLower.includes("failed") ||
    lsLower.includes("error") ||
    lsLower.includes("unverifiable")
  ) {
    state = "expired"; // Treat failed registration as a problem state
  } else if (
    entitlementType.includes("eval") ||
    entitlementType.includes("trial")
  ) {
    state = "evaluation";
  } else if (
    lsLower.includes("initialization") ||
    lsLower.includes("provisioning") ||
    lsLower.includes("pending")
  ) {
    state = "unknown"; // Still in progress
  } else if (expiryDays !== undefined && expiryDays > 0) {
    state = "active";
  }

  return {
    state,
    installed,
    readOnly,
    clientPodRunning,
    rawState: licenseState,
    entitlementType: data.entitlement_type ?? undefined,
    digitalAssetId: data.digital_asset_id ?? undefined,
    expiryDate: data.license_expiry_date ?? undefined,
    expiryDays,
    telemetryState: data.telemetry_state ?? undefined,
    telemetryMessage: data.telemetry_message ?? undefined,
    error: errorMsg,
    suggestedAction,
  };
}

// Hashes of licensing queries whose next fetch must bypass the backend cache.
const forceNextLicensingFetch = new Set<string>();

/** Refetch license status and CWC status past the backend cache (explicit Refresh). */
export function refreshLicensing(
  queryClient: QueryClient,
  clusterId?: number | null,
) {
  if (clusterId) {
    const keys = [
      LICENSING_KEYS.status(clusterId),
      LICENSING_KEYS.cwcStatus(clusterId),
    ] as const;
    for (const key of keys) {
      forceNextLicensingFetch.add(hashKey(key));
      for (const query of queryClient
        .getQueryCache()
        .findAll({ queryKey: key })) {
        forceNextLicensingFetch.add(query.queryHash);
      }
    }
    return Promise.all(
      keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
    ).then(() => undefined);
  }
  for (const query of queryClient
    .getQueryCache()
    .findAll({ queryKey: LICENSING_KEYS.all })) {
    forceNextLicensingFetch.add(query.queryHash);
  }
  return queryClient.invalidateQueries({ queryKey: LICENSING_KEYS.all });
}

/** Get CWC license and telemetry status for a cluster */
export function useLicenseStatus(
  clusterId: number,
  enabled = true,
  options?: { createClientPod?: boolean },
) {
  const createClientPod = options?.createClientPod;
  const query = useQuery({
    queryKey: LICENSING_KEYS.status(clusterId),
    queryFn: async ({ queryKey }) => {
      const qHash = hashKey(queryKey);
      const force = forceNextLicensingFetch.has(qHash) || undefined;
      try {
        return await licensingApi.getStatus(clusterId, {
          force,
          createClientPod: createClientPod || Boolean(force) || undefined,
        });
      } finally {
        forceNextLicensingFetch.delete(qHash);
      }
    },
    enabled: enabled && clusterId > 0,
    staleTime: 60_000, // 1 minute — license status changes infrequently
    retry: 1,
  });

  // If a prior passive check cached `client_pod_running: false` and this caller
  // explicitly opted into `createClientPod: true` (e.g. opening the Licensing tab),
  // refetch once so the backend upgrades the passive stub to an active CWC query.
  const refetch = query.refetch;
  useEffect(() => {
    if (
      enabled &&
      clusterId > 0 &&
      createClientPod &&
      query.data?.client_pod_running === false &&
      !query.isFetching
    ) {
      void refetch();
    }
  }, [
    enabled,
    clusterId,
    createClientPod,
    query.data?.client_pod_running,
    query.isFetching,
    refetch,
  ]);

  const licenseInfo = useMemo(
    () => parseLicenseStatus(query.data),
    [query.data],
  );

  return {
    ...query,
    licenseInfo,
  };
}

/** Get CWC telemetry report for a cluster */
export function useLicenseReport(clusterId: number, enabled = true) {
  return useQuery({
    queryKey: LICENSING_KEYS.report(clusterId),
    queryFn: () => licensingApi.getReport(clusterId),
    enabled: enabled && clusterId > 0,
    staleTime: 30_000,
    retry: 1,
  });
}

/** Full CWC connectivity and certificate status check */
export function useCWCStatus(clusterId: number, enabled = true) {
  return useQuery({
    queryKey: LICENSING_KEYS.cwcStatus(clusterId),
    queryFn: async ({ queryKey }) => {
      const qHash = hashKey(queryKey);
      const force = forceNextLicensingFetch.has(qHash) || undefined;
      try {
        return await licensingApi.getCWCStatus(clusterId, force);
      } finally {
        forceNextLicensingFetch.delete(qHash);
      }
    },
    enabled: enabled && clusterId > 0,
    staleTime: 60_000,
    retry: 1,
  });
}

/** Activate/switch CWC license */
export function useActivateLicense() {
  const queryClient = useQueryClient();

  return useAppMutation({
    mutationFn: ({
      clusterId,
      data,
    }: {
      clusterId: number;
      data: LicenseActivateRequest;
    }) => licensingApi.activate(clusterId, data),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: LICENSING_KEYS.status(variables.clusterId),
      });
      queryClient.invalidateQueries({
        queryKey: LICENSING_KEYS.cwcStatus(variables.clusterId),
      });
    },
  });
}

/**
 * Renew / switch license.
 *
 * Default (force=false): Clean API-based switch via CWC /reactivate.
 *   No CWC downtime, telemetry history preserved.
 *
 * Force (force=true): Nuclear renewal — deletes CPCL state, restarts
 *   CWC pod (~2 min downtime), then reactivates.
 */
export function useRenewLicense() {
  const queryClient = useQueryClient();

  return useAppMutation({
    mutationFn: ({
      clusterId,
      data,
    }: {
      clusterId: number;
      data: LicenseRenewRequest;
    }) => licensingApi.renew(clusterId, data),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: LICENSING_KEYS.status(variables.clusterId),
      });
      queryClient.invalidateQueries({
        queryKey: LICENSING_KEYS.cwcStatus(variables.clusterId),
      });
    },
  });
}

/** Validate and fix JWKS ConfigMap (cpcl-key-cm) on a cluster */
export function useValidateJwks() {
  const queryClient = useQueryClient();

  return useAppMutation<JwksValidationResponse, Error, { clusterId: number }>({
    mutationFn: ({ clusterId }) => licensingApi.validateJwks(clusterId),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: LICENSING_KEYS.status(variables.clusterId),
      });
      queryClient.invalidateQueries({
        queryKey: LICENSING_KEYS.cwcStatus(variables.clusterId),
      });
    },
  });
}

/** Send signed manifest (receipt) to CWC */
export function usePostLicenseReceipt() {
  const queryClient = useQueryClient();

  return useAppMutation({
    mutationFn: ({
      clusterId,
      data,
    }: {
      clusterId: number;
      data: LicenseReceiptRequest;
    }) => licensingApi.postReceipt(clusterId, data),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: LICENSING_KEYS.status(variables.clusterId),
      });
    },
  });
}
