/**
 * FU-011: lib/storage-keys — localStorage key constants
 */
import { describe, it, expect } from "vitest";
import { STORAGE_KEYS } from "../storage-keys";

describe("STORAGE_KEYS", () => {
  it("has expected keys", () => {
    const expectedKeys = [
      "PROJECT_SCOPE",
      "CLUSTER_SCOPE",
      "K8S_PROJECT",
      "K8S_CLUSTER",
      "BNK_PROJECT",
      "BNK_CLUSTER",
      "CNF_PROJECT",
      "CNF_CLUSTER",
      "AUTH_TOKEN",
      "ONBOARDING_COMPLETE",
      "MOCKUP_THEME",
    ];
    for (const key of expectedKeys) {
      expect(STORAGE_KEYS).toHaveProperty(key);
    }
  });

  it("values are all strings", () => {
    for (const value of Object.values(STORAGE_KEYS)) {
      expect(typeof value).toBe("string");
    }
  });

  it("values are unique apart from the shared project and cluster scopes", () => {
    const values = Object.values(STORAGE_KEYS).filter(
      (v) =>
        v !== STORAGE_KEYS.CLUSTER_SCOPE && v !== STORAGE_KEYS.PROJECT_SCOPE,
    );
    const uniqueValues = new Set(values);
    expect(uniqueValues.size).toBe(values.length);
  });

  it("has auth token key", () => {
    expect(STORAGE_KEYS.AUTH_TOKEN).toBe("auth_token");
  });

  it("shares one project scope across cluster-scoped pages", () => {
    expect(STORAGE_KEYS.PROJECT_SCOPE).toBe("bnk-forge-project-scope");
    expect(STORAGE_KEYS.K8S_PROJECT).toBe(STORAGE_KEYS.PROJECT_SCOPE);
    expect(STORAGE_KEYS.BNK_PROJECT).toBe(STORAGE_KEYS.PROJECT_SCOPE);
    expect(STORAGE_KEYS.CNF_PROJECT).toBe(STORAGE_KEYS.PROJECT_SCOPE);
  });

  it("shares one cluster scope across cluster-scoped pages", () => {
    expect(STORAGE_KEYS.K8S_CLUSTER).toBe(STORAGE_KEYS.CLUSTER_SCOPE);
    expect(STORAGE_KEYS.BNK_CLUSTER).toBe(STORAGE_KEYS.CLUSTER_SCOPE);
    expect(STORAGE_KEYS.CNF_CLUSTER).toBe(STORAGE_KEYS.CLUSTER_SCOPE);
  });
});
