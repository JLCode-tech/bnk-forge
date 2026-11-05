import { describe, expect, it } from "vitest";
import {
  compareBlueprintVersions,
  formatVariantOptionLabel,
  isCanonicalBlueprintId,
  normalizeBnkVersion,
  resolveBlueprintFamilyMeta,
  shouldAutoSuppressBlueprint,
  sortVersionsDesc,
} from "../blueprintVersionUtils";

describe("compareBlueprintVersions", () => {
  describe("pure semver", () => {
    it("orders 0.7.1 > 0.7.0", () => {
      expect(compareBlueprintVersions("0.7.1", "0.7.0")).toBeGreaterThan(0);
    });

    it("orders 0.7.0 > 0.6.0", () => {
      expect(compareBlueprintVersions("0.7.0", "0.6.0")).toBeGreaterThan(0);
    });

    it("orders 0.6.0 > 0.5.0", () => {
      expect(compareBlueprintVersions("0.6.0", "0.5.0")).toBeGreaterThan(0);
    });

    it("correctly orders the full set 0.7.1 > 0.7.0 > 0.6.0 > 0.5.0", () => {
      const input = ["0.5.0", "0.7.1", "0.6.0", "0.7.0"];
      const sorted = sortVersionsDesc(input, (v) => v);
      expect(sorted).toEqual(["0.7.1", "0.7.0", "0.6.0", "0.5.0"]);
    });

    it("returns 0 for equal versions", () => {
      expect(compareBlueprintVersions("1.2.3", "1.2.3")).toBe(0);
    });

    it("compares by major version", () => {
      expect(compareBlueprintVersions("2.0.0", "1.9.9")).toBeGreaterThan(0);
    });

    it("compares by minor version", () => {
      expect(compareBlueprintVersions("1.10.0", "1.9.0")).toBeGreaterThan(0);
    });

    it("compares by patch version", () => {
      expect(compareBlueprintVersions("1.2.10", "1.2.9")).toBeGreaterThan(0);
    });

    it("compares 2-part versions like 2.4.1 > 2.3", () => {
      expect(compareBlueprintVersions("2.4.1", "2.3")).toBeGreaterThan(0);
      expect(compareBlueprintVersions("2.3", "2.4.1")).toBeLessThan(0);
    });
  });

  describe("semver with pre-release / EHF suffix", () => {
    it("stable 2.3.0 > pre-release 2.3.0-ehf-2-3.2598.3-0.0.17", () => {
      expect(
        compareBlueprintVersions("2.3.0", "2.3.0-ehf-2-3.2598.3-0.0.17"),
      ).toBeGreaterThan(0);
    });

    it("pre-release 2.3.0-ehf < stable 2.3.0", () => {
      expect(
        compareBlueprintVersions("2.3.0-ehf-2-3.2598.3-0.0.17", "2.3.0"),
      ).toBeLessThan(0);
    });

    it("stable higher version beats lower stable (both parse)", () => {
      expect(
        compareBlueprintVersions("2.4.0", "2.3.0-ehf-2-3.2598.3-0.0.17"),
      ).toBeGreaterThan(0);
    });

    it("two pre-releases with same base compare lexicographically by pre string", () => {
      const result = compareBlueprintVersions("1.0.0-rc.2", "1.0.0-rc.1");
      expect(result).toBeGreaterThan(0);
    });
  });

  describe("malformed / non-semver fallback to lexicographic", () => {
    it("falls back lexicographically for non-parseable strings", () => {
      // "b" > "a" lexicographically
      expect(compareBlueprintVersions("b", "a")).toBeGreaterThan(0);
    });

    it("non-parseable string is treated as older than any valid semver", () => {
      expect(compareBlueprintVersions("not-a-version", "1.0.0")).toBeLessThan(
        0,
      );
      expect(
        compareBlueprintVersions("1.0.0", "not-a-version"),
      ).toBeGreaterThan(0);
    });

    it("two non-parseable strings compare lexicographically", () => {
      const result = compareBlueprintVersions("banana", "apple");
      expect(result).toBeGreaterThan(0); // 'b' > 'a'
    });
  });

  describe("sortVersionsDesc", () => {
    it("returns a new array, does not mutate the input", () => {
      const input = ["1.0.0", "2.0.0"];
      const sorted = sortVersionsDesc(input, (v) => v);
      expect(input).toEqual(["1.0.0", "2.0.0"]);
      expect(sorted).toEqual(["2.0.0", "1.0.0"]);
    });

    it("sorts objects by a version key", () => {
      const items = [
        { id: 1, version: "0.5.0" },
        { id: 3, version: "0.7.1" },
        { id: 2, version: "0.6.0" },
      ];
      const sorted = sortVersionsDesc(items, (i) => i.version);
      expect(sorted.map((i) => i.version)).toEqual(["0.7.1", "0.6.0", "0.5.0"]);
    });
  });

  describe("normalizeBnkVersion & family grouping metadata", () => {
    it("normalizes 2.4 and 2.4.x to 2.4.1 and 2.3.0 to 2.3", () => {
      expect(normalizeBnkVersion("2.4")).toBe("2.4.1");
      expect(normalizeBnkVersion("2.4.x")).toBe("2.4.1");
      expect(normalizeBnkVersion("2.4.1")).toBe("2.4.1");
      expect(normalizeBnkVersion("2.3")).toBe("2.3");
      expect(normalizeBnkVersion("2.3.0")).toBe("2.3");
      expect(normalizeBnkVersion(null)).toBeNull();
    });

    it("resolves canonical family metadata for AWS EKS BNK variants with Traffic-Ready as recommended", () => {
      const secureMeta = resolveBlueprintFamilyMeta({
        blueprint_id: "aws-eks-bnk241-secure",
      });
      expect(secureMeta.family_id).toBe("aws-eks-bnk");
      expect(secureMeta.family_name).toBe("AWS EKS — F5 BNK Full Stack");
      expect(secureMeta.deployment_pattern).toBe("full-stack");
      expect(secureMeta.variant_key).toBe("secure");
      expect(secureMeta.is_recommended).toBe(false);
      expect(secureMeta.bnk_version).toBe("2.4.1");

      const trafficMeta = resolveBlueprintFamilyMeta({
        blueprint_id: "aws-eks-bnk241-traffic",
      });
      expect(trafficMeta.family_id).toBe("aws-eks-bnk");
      expect(trafficMeta.variant_key).toBe("traffic");
      expect(trafficMeta.is_recommended).toBe(true);
      expect(trafficMeta.bnk_version).toBe("2.4.1");
    });

    it("auto-suppresses superseded built-in blueprints when external replacements are present", () => {
      const allIds = new Set([
        "awsbnkctl-bnk-demo",
        "aws-eks-bnk241-secure",
        "aws-eks-infra",
      ]);
      expect(shouldAutoSuppressBlueprint("awsbnkctl-bnk-demo", allIds)).toBe(
        true,
      );
      expect(shouldAutoSuppressBlueprint("aws-eks-infra", allIds)).toBe(true);
      expect(shouldAutoSuppressBlueprint("aws-eks-bnk241-secure", allIds)).toBe(
        false,
      );
    });

    it("retains aws-k8s-foundation when only external AWS BNK stacks exist", () => {
      const onlyExternalBnk = new Set([
        "aws-k8s-foundation",
        "aws-eks-bnk241-secure",
      ]);
      expect(
        shouldAutoSuppressBlueprint("aws-k8s-foundation", onlyExternalBnk),
      ).toBe(false);

      const withExternalInfra = new Set([
        "aws-k8s-foundation",
        "aws-eks-cluster-create",
      ]);
      expect(
        shouldAutoSuppressBlueprint("aws-k8s-foundation", withExternalInfra),
      ).toBe(true);
    });
  });

  describe("formatVariantOptionLabel and isCanonicalBlueprintId", () => {
    it("avoids duplicate Recommended suffix in formatVariantOptionLabel", () => {
      expect(
        formatVariantOptionLabel(
          "Single-NIC Secure BNK 2.4.1 (Recommended)",
          true,
        ),
      ).toBe("Single-NIC Secure BNK 2.4.1 ★ Recommended");
      expect(formatVariantOptionLabel("Dual-NIC", false)).toBe("Dual-NIC");
    });

    it("identifies canonical blueprint IDs across sources", () => {
      expect(isCanonicalBlueprintId("bnk-241-on-k8s")).toBe(true);
      expect(isCanonicalBlueprintId("bnk-on-k8s")).toBe(true);
      expect(isCanonicalBlueprintId("custom-user-blueprint")).toBe(false);
    });
  });
});
