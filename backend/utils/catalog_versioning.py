"""Shared catalog-versioning primitives (D-033).

Single home for the two idioms that were previously copy-pasted per service:
canonical content hashing (module sync, blueprint sync, blueprint catalog) and
tolerant semver ordering (module is_latest recompute, registry latest-version
pick). Keeping one definition prevents the two failure modes review #433
flagged: hash canonicalization drift producing spurious immutability conflicts,
and two backends disagreeing on which version is "latest".
"""

from __future__ import annotations

import hashlib
import json
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from sqlalchemy.orm import Session


def canonical_json_sha256(obj: object) -> str:
    """sha256 over the canonical JSON form of ``obj``.

    ``default=str`` keeps the hash total (datetime/Decimal stringify instead of
    raising); for JSON-serializable content the output is byte-identical to the
    pre-helper call sites, so stored hashes remain valid.
    """
    return hashlib.sha256(
        json.dumps(obj, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")
    ).hexdigest()


def version_sort_key(version: str | None) -> tuple:
    """Tolerant semver-ish ordering key.

    Handles the shapes seen in real catalogs: '1.20.0', 'v2.3.1',
    '2.3.0-ehf-2-3.2598.3-0.0.17'. Numeric dotted segments dominate; a release
    outranks a pre-release of the same numeric core; unparseable versions sort
    lowest (call sites break ties by row id / recency).
    """
    if not version:
        return ((), 0, "")
    # Build metadata (+build.7) carries no precedence per semver; strip it
    # before parsing (the registry _semver_key this consolidated also did),
    # or int("1+build") breaks and the version ranks below its patch series.
    bare = version.strip().lstrip("vV").split("+", 1)[0]
    core, _, prerelease = bare.partition("-")
    numeric_parts: list[int] = []
    for part in core.split("."):
        try:
            numeric_parts.append(int(part))
        except ValueError:
            break
    return (tuple(numeric_parts), 0 if prerelease else 1, prerelease)


# Canonical blueprint family and variant mappings for known blueprint IDs.
_BLUEPRINT_CATALOG_METADATA: dict[str, dict[str, object]] = {
    "aws-eks-bnk241-secure": {
        "family_id": "aws-eks-bnk",
        "family_name": "AWS EKS \u2014 F5 BNK Full Stack",
        "deployment_pattern": "greenfield_full_stack",
        "variant_key": "secure",
        "variant_label": "Secure + Bastion",
        "bnk_version": "2.4.1",
        "is_recommended": False,
    },
    "aws-eks-bnk241-traffic": {
        "family_id": "aws-eks-bnk",
        "family_name": "AWS EKS \u2014 F5 BNK Full Stack",
        "deployment_pattern": "greenfield_full_stack",
        "variant_key": "traffic",
        "variant_label": "Traffic-Ready (HP Nodes) (Recommended)",
        "bnk_version": "2.4.1",
        "is_recommended": True,
    },
    "aws-eks-bnk23-secure": {
        "family_id": "aws-eks-bnk",
        "family_name": "AWS EKS \u2014 F5 BNK Full Stack",
        "deployment_pattern": "greenfield_full_stack",
        "variant_key": "secure",
        "variant_label": "Secure + Bastion",
        "bnk_version": "2.3.0",
        "is_recommended": False,
    },
    "aws-eks-bnk23-traffic": {
        "family_id": "aws-eks-bnk",
        "family_name": "AWS EKS \u2014 F5 BNK Full Stack",
        "deployment_pattern": "greenfield_full_stack",
        "variant_key": "traffic",
        "variant_label": "Traffic-Ready (HP Nodes) (Recommended)",
        "bnk_version": "2.3.0",
        "is_recommended": True,
    },
    "aws-eks-cluster-create": {
        "family_id": "aws-eks-bnk",
        "family_name": "AWS EKS \u2014 F5 BNK Full Stack",
        "deployment_pattern": "greenfield_full_stack",
        "variant_key": "standard",
        "variant_label": "Standard (Managed Nodes Only)",
        "bnk_version": "2.4.1",
        "is_recommended": False,
    },
    "aws-eks-cluster-create-with-hp-nodes": {
        "family_id": "aws-eks-bnk",
        "family_name": "AWS EKS \u2014 F5 BNK Full Stack",
        "deployment_pattern": "greenfield_full_stack",
        "variant_key": "hp-nodes",
        "variant_label": "With HP TMM Nodes (Customizable)",
        "bnk_version": "2.4.1",
        "is_recommended": False,
    },
    "aws-eks-existing-cluster": {
        "family_id": "aws-eks-existing-cluster-bnk",
        "family_name": "AWS EKS \u2014 F5 BNK on Existing Cluster",
        "deployment_pattern": "existing_cluster_overlay",
        "variant_key": "standard",
        "variant_label": "Standard (Existing Nodes)",
        "bnk_version": "2.4.1",
        "is_recommended": True,
    },
    "aws-eks-existing-cluster-with-hp-nodes": {
        "family_id": "aws-eks-existing-cluster-bnk",
        "family_name": "AWS EKS \u2014 F5 BNK on Existing Cluster",
        "deployment_pattern": "existing_cluster_overlay",
        "variant_key": "hp-nodes",
        "variant_label": "With HP TMM Nodes (Recommended for TMM)",
        "bnk_version": "2.4.1",
        "is_recommended": False,
    },
    "aws-eks-existing-cluster-bnk241": {
        "family_id": "aws-eks-existing-cluster-bnk",
        "family_name": "AWS EKS \u2014 F5 BNK on Existing Cluster",
        "deployment_pattern": "existing_cluster_overlay",
        "variant_key": "secure",
        "variant_label": "Secure Mode (Recommended)",
        "bnk_version": "2.4.1",
        "is_recommended": True,
    },
    "aws-eks-existing-cluster-bnk241-traffic": {
        "family_id": "aws-eks-existing-cluster-bnk",
        "family_name": "AWS EKS \u2014 F5 BNK on Existing Cluster",
        "deployment_pattern": "existing_cluster_overlay",
        "variant_key": "traffic",
        "variant_label": "With L4 Traffic Validation",
        "bnk_version": "2.4.1",
        "is_recommended": False,
    },
    "aws-eks-existing-cluster-traffic": {
        "family_id": "aws-eks-existing-cluster-bnk",
        "family_name": "AWS EKS \u2014 F5 BNK on Existing Cluster",
        "deployment_pattern": "existing_cluster_overlay",
        "variant_key": "traffic",
        "variant_label": "With L4 Traffic Validation",
        "bnk_version": "2.3.0",
        "is_recommended": False,
    },
    "bnk-241-live-observability-foundation": {
        "family_id": "bnk-live-observability-foundation",
        "family_name": "F5 BNK \u2014 Live Observability & Validation Stack",
        "deployment_pattern": "workload_validation",
        "variant_key": "observability",
        "variant_label": "Live Observability + Validation (Recommended)",
        "bnk_version": "2.4.1",
        "is_recommended": True,
    },
    "bnk-live-observability-foundation": {
        "family_id": "bnk-live-observability-foundation",
        "family_name": "F5 BNK \u2014 Live Observability & Validation Stack",
        "deployment_pattern": "workload_validation",
        "variant_key": "observability",
        "variant_label": "Live Observability + Validation",
        "bnk_version": "2.3.0",
        "is_recommended": False,
    },
    "aws-k8s-foundation": {
        "family_id": "aws-k8s-foundation",
        "family_name": "AWS EKS \u2014 Cluster Foundation",
        "deployment_pattern": "cluster_foundation",
        "variant_key": "standard",
        "variant_label": "Production Foundation (Recommended)",
        "bnk_version": None,
        "is_recommended": True,
    },
    "aws-eks-cluster-demo": {
        "family_id": "aws-k8s-foundation",
        "family_name": "AWS EKS \u2014 Cluster Foundation",
        "deployment_pattern": "cluster_foundation",
        "variant_key": "demo",
        "variant_label": "Demo (Minimal VPC + EKS)",
        "bnk_version": None,
        "is_recommended": False,
    },
    "awsbnkctl-bnk-demo": {
        "family_id": "awsbnkctl-bnk-demo",
        "family_name": "AWS EKS \u2014 CLI Demo Reference (awsbnkctl)",
        "deployment_pattern": "greenfield_full_stack",
        "variant_key": "cli-demo",
        "variant_label": "CLI Reference Topology",
        "bnk_version": "2.2.0",
        "is_recommended": False,
    },
    "azure-aks-foundation": {
        "family_id": "azure-aks-foundation",
        "family_name": "Azure AKS \u2014 Cluster Foundation",
        "deployment_pattern": "cluster_foundation",
        "variant_key": "standard",
        "variant_label": "Standard AKS Foundation",
        "bnk_version": None,
        "is_recommended": True,
    },
    "gcp-gke-foundation": {
        "family_id": "gcp-gke-foundation",
        "family_name": "GCP GKE \u2014 Cluster Foundation",
        "deployment_pattern": "cluster_foundation",
        "variant_key": "standard",
        "variant_label": "Standard GKE Foundation",
        "bnk_version": None,
        "is_recommended": True,
    },
    "ocp-connection": {
        "family_id": "ocp-connection",
        "family_name": "Red Hat OpenShift \u2014 Cluster Connection",
        "deployment_pattern": "cluster_foundation",
        "variant_key": "standard",
        "variant_label": "Existing OpenShift Cluster",
        "bnk_version": None,
        "is_recommended": True,
    },
    "ubuntu-kind-foundation": {
        "family_id": "ubuntu-kind-foundation",
        "family_name": "Ubuntu Kind \u2014 Local Dev Cluster",
        "deployment_pattern": "cluster_foundation",
        "variant_key": "standard",
        "variant_label": "Single-Host Kind Cluster",
        "bnk_version": None,
        "is_recommended": True,
    },
    "bnk-241-on-k8s": {
        "family_id": "bnk-on-k8s",
        "family_name": "F5 BNK Platform \u2014 Kubernetes Overlay",
        "deployment_pattern": "existing_cluster_overlay",
        "variant_key": "aws-eks",
        "variant_label": "AWS EKS Optimized (Recommended)",
        "bnk_version": "2.4.1",
        "is_recommended": True,
    },
    "bnk-241-on-k8s-generic": {
        "family_id": "bnk-on-k8s",
        "family_name": "F5 BNK Platform \u2014 Kubernetes Overlay",
        "deployment_pattern": "existing_cluster_overlay",
        "variant_key": "generic",
        "variant_label": "Multi-Platform Generic (SR-IOV)",
        "bnk_version": "2.4.1",
        "is_recommended": False,
    },
    "bnk-on-k8s": {
        "family_id": "bnk-on-k8s",
        "family_name": "F5 BNK Platform \u2014 Kubernetes Overlay",
        "deployment_pattern": "existing_cluster_overlay",
        "variant_key": "aws-eks",
        "variant_label": "AWS EKS Optimized",
        "bnk_version": "2.2.0",
        "is_recommended": False,
    },
    "bnk-on-k8s-generic": {
        "family_id": "bnk-on-k8s",
        "family_name": "F5 BNK Platform \u2014 Kubernetes Overlay",
        "deployment_pattern": "existing_cluster_overlay",
        "variant_key": "generic",
        "variant_label": "Multi-Platform Generic (SR-IOV)",
        "bnk_version": "2.2.0",
        "is_recommended": False,
    },
    "bnk-bare-metal-dpu-infra": {
        "family_id": "bnk-bare-metal-dpu-infra",
        "family_name": "Bare-Metal BlueField DPU \u2014 Cluster Foundation",
        "deployment_pattern": "cluster_foundation",
        "variant_key": "standard",
        "variant_label": "DPU Flash + K8s Bootstrap",
        "bnk_version": None,
        "is_recommended": True,
    },
    "bnk-bare-metal-full-poc": {
        "family_id": "bnk-bare-metal-full-poc",
        "family_name": "Bare-Metal BlueField DPU \u2014 F5 BNK Full Stack",
        "deployment_pattern": "greenfield_full_stack",
        "variant_key": "all-in-one",
        "variant_label": "All-in-One DPU + BNK PoC",
        "bnk_version": "2.2.0",
        "is_recommended": True,
    },
    "bnk-bare-metal-full-poc-ssh": {
        "family_id": "bnk-bare-metal-full-poc",
        "family_name": "Bare-Metal BlueField DPU \u2014 F5 BNK Full Stack",
        "deployment_pattern": "greenfield_full_stack",
        "variant_key": "ssh",
        "variant_label": "SSH Host Execution (Legacy)",
        "bnk_version": "2.2.0",
        "is_recommended": False,
    },
    "bnk-demo-apps": {
        "family_id": "bnk-demo-apps",
        "family_name": "F5 BNK \u2014 GenAI Gateway & Demo Workloads",
        "deployment_pattern": "workload_validation",
        "variant_key": "genai-gateway",
        "variant_label": "GenAI Gateway Suite (Recommended)",
        "bnk_version": "2.2.0",
        "is_recommended": True,
    },
    "eks-bnk-smartllm-demo": {
        "family_id": "bnk-demo-apps",
        "family_name": "F5 BNK \u2014 GenAI Gateway & Demo Workloads",
        "deployment_pattern": "workload_validation",
        "variant_key": "smartllm-router",
        "variant_label": "SmartLLM Traffic-Weighted Router",
        "bnk_version": "2.2.0",
        "is_recommended": False,
    },
    "ibm-roks-bnk241-single-nic": {
        "family_id": "ibm-roks-bnk-full-stack",
        "family_name": "IBM Cloud ROKS \u2014 F5 BNK Full Stack",
        "deployment_pattern": "greenfield_full_stack",
        "variant_key": "single-nic",
        "variant_label": "Single-NIC (Recommended)",
        "bnk_version": "2.4.1",
        "is_recommended": True,
    },
    "ibm-roks-bnk241-dual-nic": {
        "family_id": "ibm-roks-bnk-full-stack",
        "family_name": "IBM Cloud ROKS \u2014 F5 BNK Full Stack",
        "deployment_pattern": "greenfield_full_stack",
        "variant_key": "dual-nic",
        "variant_label": "Dual-NIC",
        "bnk_version": "2.4.1",
        "is_recommended": False,
    },
    "ibm-roks-bnk-single-nic": {
        "family_id": "ibm-roks-bnk-full-stack",
        "family_name": "IBM Cloud ROKS \u2014 F5 BNK Full Stack",
        "deployment_pattern": "greenfield_full_stack",
        "variant_key": "single-nic",
        "variant_label": "Single-NIC (Recommended)",
        "bnk_version": "2.3.0",
        "is_recommended": True,
    },
    "ibm-roks-bnk-dual-nic": {
        "family_id": "ibm-roks-bnk-full-stack",
        "family_name": "IBM Cloud ROKS \u2014 F5 BNK Full Stack",
        "deployment_pattern": "greenfield_full_stack",
        "variant_key": "dual-nic",
        "variant_label": "Dual-NIC",
        "bnk_version": "2.3.0",
        "is_recommended": False,
    },
    "ibm-roks-existing-cluster-bnk241-single-nic": {
        "family_id": "ibm-roks-bnk-existing-cluster",
        "family_name": "IBM Cloud ROKS \u2014 F5 BNK on Existing Cluster",
        "deployment_pattern": "existing_cluster_overlay",
        "variant_key": "single-nic",
        "variant_label": "Single-NIC (Recommended)",
        "bnk_version": "2.4.1",
        "is_recommended": True,
    },
    "ibm-roks-existing-cluster-bnk241-dual-nic": {
        "family_id": "ibm-roks-bnk-existing-cluster",
        "family_name": "IBM Cloud ROKS \u2014 F5 BNK on Existing Cluster",
        "deployment_pattern": "existing_cluster_overlay",
        "variant_key": "dual-nic",
        "variant_label": "Dual-NIC",
        "bnk_version": "2.4.1",
        "is_recommended": False,
    },
    "ibm-roks-existing-cluster-bnk-single-nic": {
        "family_id": "ibm-roks-bnk-existing-cluster",
        "family_name": "IBM Cloud ROKS \u2014 F5 BNK on Existing Cluster",
        "deployment_pattern": "existing_cluster_overlay",
        "variant_key": "single-nic",
        "variant_label": "Single-NIC (Recommended)",
        "bnk_version": "2.3.0",
        "is_recommended": True,
    },
    "ibm-roks-existing-cluster-bnk-dual-nic": {
        "family_id": "ibm-roks-bnk-existing-cluster",
        "family_name": "IBM Cloud ROKS \u2014 F5 BNK on Existing Cluster",
        "deployment_pattern": "existing_cluster_overlay",
        "variant_key": "dual-nic",
        "variant_label": "Dual-NIC",
        "bnk_version": "2.3.0",
        "is_recommended": False,
    },
    "ibm-roks-cluster": {
        "family_id": "ibm-roks-infra",
        "family_name": "IBM Cloud ROKS \u2014 Cluster Infrastructure",
        "deployment_pattern": "cluster_foundation",
        "variant_key": "create-cluster",
        "variant_label": "Create New ROKS Cluster (Recommended)",
        "bnk_version": None,
        "is_recommended": True,
    },
    "ibm-roks-existing-cluster": {
        "family_id": "ibm-roks-infra",
        "family_name": "IBM Cloud ROKS \u2014 Cluster Infrastructure",
        "deployment_pattern": "existing_cluster_overlay",
        "variant_key": "register-existing",
        "variant_label": "Register Existing ROKS Cluster",
        "bnk_version": None,
        "is_recommended": False,
    },
}


def normalize_bnk_version(raw: str | None) -> str | None:
    """Normalize BNK release strings ('2.3' -> '2.3.0', '2.2' -> '2.2.0', '2.4.1' -> '2.4.1')."""
    if not raw or not isinstance(raw, str):
        return None
    cleaned = raw.strip().lstrip("vV")
    if not cleaned:
        return None
    if cleaned in ("2.3", "2.3.0"):
        return "2.3.0"
    if cleaned in ("2.2", "2.2.0", "2.2+"):
        return "2.2.0"
    if cleaned == "2.4":
        return "2.4.1"
    return cleaned


def resolve_blueprint_catalog_metadata(
    blueprint_id: str,
    manifest: dict | None = None,
    fallback_name: str | None = None,
    category: str | None = None,
    raw_bnk_version: str | None = None,
) -> dict[str, object]:
    """Return canonical family, variant, deployment_pattern, bnk_version, and title metadata."""
    manifest_dict = manifest if isinstance(manifest, dict) else {}
    bp_block = manifest_dict.get("blueprint") if isinstance(manifest_dict.get("blueprint"), dict) else {}
    defaults = _BLUEPRINT_CATALOG_METADATA.get(blueprint_id, {})

    family_id = manifest_dict.get("family_id") or bp_block.get("family_id") or defaults.get("family_id") or blueprint_id
    deployment_pattern = (
        manifest_dict.get("deployment_pattern")
        or bp_block.get("deployment_pattern")
        or defaults.get("deployment_pattern")
    )
    if not deployment_pattern:
        cat = (category or manifest_dict.get("category") or "").lower()
        if cat == "solution":
            deployment_pattern = "workload_validation"
        elif cat == "bnk":
            deployment_pattern = "existing_cluster_overlay"
        else:
            deployment_pattern = "cluster_foundation"

    variant_key = (
        manifest_dict.get("variant_key") or bp_block.get("variant_key") or defaults.get("variant_key") or "standard"
    )
    variant_label = (
        manifest_dict.get("variant_label")
        or bp_block.get("variant_label")
        or defaults.get("variant_label")
        or "Standard"
    )
    bnk_ver = normalize_bnk_version(
        raw_bnk_version
        or manifest_dict.get("bnk_version")
        or bp_block.get("bnk_version")
        or (defaults.get("bnk_version") if isinstance(defaults.get("bnk_version"), str) else None)
    )
    is_rec_raw = manifest_dict.get("is_recommended")
    if is_rec_raw is None:
        is_rec_raw = bp_block.get("is_recommended")
    if is_rec_raw is None:
        is_rec_raw = defaults.get("is_recommended", False)

    family_name = defaults.get("family_name") or bp_block.get("name") or fallback_name or blueprint_id
    raw_cp = manifest_dict.get("cloud_provider") or bp_block.get("cloud_provider")
    cat_lower = (category or manifest_dict.get("category") or "").lower()
    if not raw_cp and (cat_lower == "bare-metal" or blueprint_id.startswith("bnk-bare-metal")):
        raw_cp = "bare-metal"
    return {
        "family_id": str(family_id),
        "family_name": str(family_name),
        "deployment_pattern": str(deployment_pattern),
        "variant_key": str(variant_key),
        "variant_label": str(variant_label),
        "bnk_version": bnk_ver,
        "is_recommended": bool(is_rec_raw),
        "cloud_provider": str(raw_cp) if raw_cp else None,
    }


_CANONICAL_MODULE_PATH_TO_SLUG: dict[str, str] = {
    "k8s/bnk-cert-issuer": "bnk-cert-issuer",
    "modules/bnk-cert-issuer": "bnk-cert-issuer",
    "modules/eks-cluster-install-cert-issuer": "bnk-cert-issuer",
    "bare-metal/bnk-cert-issuer": "bnk-cert-issuer",
    "k8s/bnk-prerequisites": "bnk-prerequisites",
    "modules/bnk-prerequisites": "bnk-prerequisites",
    "modules/eks-cluster-install-bnk-prereqs": "bnk-prerequisites",
    "bare-metal/bnk-prerequisites": "bnk-prerequisites",
    "k8s/cert-manager": "cert-manager",
    "modules/cert-manager": "cert-manager",
    "modules/eks-cluster-install-cert-manager": "cert-manager",
    "bare-metal/cert-manager": "cert-manager",
    "k8s/hugepages": "install-hugepages",
    "modules/install-hugepages": "install-hugepages",
    "modules/eks-cluster-install-hugepages": "install-hugepages",
    "bare-metal/install-hugepages": "install-hugepages",
    "k8s/multus": "install-multus",
    "modules/install-multus": "install-multus",
    "modules/eks-cluster-install-multus": "install-multus",
    "bare-metal/install-multus": "install-multus",
    "k8s/network-setup": "network-setup",
    "bare-metal/network-setup": "network-setup",
    "bnk/f5-bnk-2.4.1": "f5-bnk-2.4.1",
    "modules/eks-cluster-bnk241-install": "f5-bnk-2.4.1",
    "bnk/f5-bnk-2.3": "f5-bnk-2.3",
    "modules/eks-cluster-bnk-install": "f5-bnk-2.3",
    "bare-metal/bnk-install": "f5-bnk-2.3",
    "bnk/f5-bnk-2.2": "f5-bnk-2.2",
    "bnk/flo": "flo",
    "modules/eks-cluster-install-flo": "flo",
    "bare-metal/bnk-flo": "flo",
    "bnk/cneinstance": "cneinstance",
    "modules/eks-cluster-cneinstall": "cneinstance",
    "bare-metal/bnk-cneinstall": "cneinstance",
    "bare-metal/bnk-cneinstance": "cneinstance",
    "bnk/crds": "bnk-crds",
    "modules/eks-cluster-install-crds": "bnk-crds",
    "bare-metal/bnk-crds": "bnk-crds",
    "bnk/gatewayclass": "bnk-gatewayclass",
    "modules/install-spkvlan-gatewayclass": "bnk-gatewayclass",
    "bare-metal/bnk-gatewayclass": "bnk-gatewayclass",
}

_SNAKE_CASE_MODULE_TITLES: dict[str, str] = {
    "aws_eks_cluster_create": "EKS Cluster Create",
    "aws_eks_cluster_register_existing": "EKS Cluster Register Existing",
    "aws_eks_cluster_hp_nodes": "EKS Cluster High-Performance Nodes",
    "aws_eks_cluster_jumphost": "EKS Cluster Bastion Jumphost",
    "aws_eks_cluster_install_tmm_nads": "EKS Cluster Install TMM NADs",
    "aws_eks_cluster_tmm_heal": "EKS Cluster TMM Cold-Start Heal",
}

_CANONICAL_SLUG_TITLES: dict[str, str] = {
    "bnk-cert-issuer": "BNK Certificate Issuer (CWC CA + JWT)",
    "bnk-prerequisites": "BNK Namespace & Pull-Secret Prerequisites",
    "cert-manager": "Jetstack cert-manager",
    "install-hugepages": "HugePages 2Mi Node DaemonSet",
    "install-multus": "Multus CNI Meta-Plugin",
    "f5-bnk-2.4.1": "F5 BIG-IP Next for Kubernetes 2.4.1",
    "f5-bnk-2.3": "F5 BIG-IP Next for Kubernetes 2.3.0",
    "f5-bnk-2.2": "F5 BIG-IP Next for Kubernetes 2.2.0",
    "flo": "F5 Lifecycle Operator (FLO)",
    "cneinstance": "BNK CNEInstance (TMM + BGP + CWC)",
    "bnk-crds": "BNK Custom Resource Definitions (CRDs)",
    "bnk-gatewayclass": "Gateway API & SPKVLAN GatewayClass",
    "eks-cluster-create": "AWS EKS Cluster Provisioning",
    "eks-cluster-create-with-hp-nodes": "AWS EKS Cluster + Multi-NIC HP Nodes",
    "eks-cluster-existing": "AWS EKS Register Existing Cluster",
    "eks-cluster-existing-with-hp-nodes": "AWS EKS Existing Cluster + HP Nodes",
    "eks-cluster-add-hp-nodes": "AWS EKS Multi-NIC TMM Node Group",
    "eks-cluster-bastion": "AWS EKS Bastion Jumphost",
    "eks-cluster-fixrouting": "AWS EKS Multi-NIC Source Routing Fix",
    "eks-cluster-secrets": "AWS EKS Pull Secrets & License Setup",
    "eks-cluster-install-tmm-nads": "AWS EKS TMM NetworkAttachmentDefinitions",
    "eks-cluster-tmm-heal": "AWS EKS TMM Cold-Start Heal",
    "ibm-roks-single-nic": "IBM Cloud ROKS VPC + Single-NIC Cluster",
    "ibm-roks-existing-cluster": "IBM Cloud ROKS Register Existing Cluster",
    "bare-metal/cert-manager": "cert-manager [SSH]",
    "bare-metal/bnk-prerequisites": "BNK Prerequisites [SSH]",
    "bare-metal/bnk-cert-issuer": "BNK Cert Issuer [SSH]",
    "bare-metal/install-multus": "Install Multus [SSH]",
}


def resolve_canonical_module_metadata(path: str | None, name: str | None) -> dict[str, str]:
    """Compute canonical module_slug and human-readable display name."""
    norm_path = (path or "").strip().strip("/")
    slug = _CANONICAL_MODULE_PATH_TO_SLUG.get(norm_path)
    if not slug:
        if norm_path.startswith("bare-metal/"):
            slug = norm_path
        else:
            slug = norm_path.rsplit("/", 1)[-1] if norm_path else (name or "unknown")

    raw_name = (name or "").strip()
    if raw_name in _SNAKE_CASE_MODULE_TITLES:
        display_name = _SNAKE_CASE_MODULE_TITLES[raw_name]
    elif slug in _CANONICAL_SLUG_TITLES:
        display_name = _CANONICAL_SLUG_TITLES[slug]
    elif "_" in raw_name and " " not in raw_name:
        # Convert any remaining snake_case identifier into Title Case
        acronyms = {
            "aws": "AWS",
            "eks": "EKS",
            "gke": "GKE",
            "aks": "AKS",
            "bnk": "BNK",
            "tmm": "TMM",
            "nads": "NADs",
            "nad": "NAD",
            "vpc": "VPC",
            "iam": "IAM",
            "cni": "CNI",
            "dpu": "DPU",
            "ssh": "SSH",
            "ip": "IP",
            "cwc": "CWC",
            "crds": "CRDs",
            "crd": "CRD",
        }
        words = [acronyms.get(w.lower(), w.capitalize()) for w in raw_name.split("_") if w]
        display_name = " ".join(words)
    else:
        display_name = raw_name or slug
    return {
        "module_slug": slug,
        "display_name": display_name,
    }


def deactivate_older_active_blueprint_releases(
    db: Session,
    blueprint_source_id: int | None = None,
    blueprint_id: str | None = None,
) -> list[int]:
    """Deactivate older active BlueprintRelease rows when a newer semver is active for the same (source_id, blueprint_id)."""
    from models import BlueprintRelease

    query = db.query(BlueprintRelease).filter(BlueprintRelease.is_active == True)  # noqa: E712
    if blueprint_source_id is not None:
        query = query.filter(BlueprintRelease.blueprint_source_id == blueprint_source_id)
    if blueprint_id is not None:
        query = query.filter(BlueprintRelease.blueprint_id == blueprint_id)

    active_releases = query.all()
    by_key: dict[tuple[int, str], list[BlueprintRelease]] = {}
    for rel in active_releases:
        by_key.setdefault((rel.blueprint_source_id, rel.blueprint_id), []).append(rel)

    deactivated_ids: list[int] = []
    for _key, group in by_key.items():
        if len(group) <= 1:
            continue
        group.sort(key=lambda r: (version_sort_key(r.blueprint_version), r.id or 0), reverse=True)
        latest_ver = group[0].blueprint_version
        for older in group[1:]:
            older.is_active = False
            older.state_reason = f"Superseded by v{latest_ver}"
            deactivated_ids.append(older.id)

    if deactivated_ids:
        db.flush()
    return deactivated_ids
