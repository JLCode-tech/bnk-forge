"""
Unit tests for services.bnk.helpers — K8s dict utilities and severity logic.

Pure functions, no I/O, no mocking needed.
"""

import pytest

from services.bnk.helpers import (
    BNK_RESOURCE_TYPES,
    _resolve_flo_version_to_bnk,
    calc_severity,
    extract_bnk_version,
    get_condition_message,
    has_condition,
    make_resource_map,
    resource_key,
    resource_name,
    resource_ns,
    rollup_severity,
    safe_get,
)

# ---------------------------------------------------------------------------
# safe_get
# ---------------------------------------------------------------------------


class TestSafeGet:
    def test_single_key(self):
        assert safe_get({"a": 1}, "a") == 1

    def test_nested_keys(self):
        assert safe_get({"a": {"b": {"c": 42}}}, "a", "b", "c") == 42

    def test_missing_key_returns_default(self):
        assert safe_get({"a": 1}, "b") is None
        assert safe_get({"a": 1}, "b", default="fallback") == "fallback"

    def test_none_value_returns_default(self):
        assert safe_get({"a": None}, "a", default="x") == "x"

    def test_non_dict_intermediate_returns_default(self):
        assert safe_get({"a": "string"}, "a", "b") is None

    def test_non_dict_input_returns_default(self):
        assert safe_get("not a dict", "a") is None
        assert safe_get(42, "a", default="d") == "d"

    def test_empty_keys(self):
        obj = {"a": 1}
        assert safe_get(obj) == obj

    def test_deeply_nested(self):
        obj = {"a": {"b": {"c": {"d": {"e": "deep"}}}}}
        assert safe_get(obj, "a", "b", "c", "d", "e") == "deep"


# ---------------------------------------------------------------------------
# resource_name / resource_ns / resource_key
# ---------------------------------------------------------------------------


class TestResourceAccessors:
    def test_resource_name(self):
        r = {"metadata": {"name": "my-gw", "namespace": "default"}}
        assert resource_name(r) == "my-gw"

    def test_resource_ns(self):
        r = {"metadata": {"name": "my-gw", "namespace": "f5-bnk"}}
        assert resource_ns(r) == "f5-bnk"

    def test_resource_key(self):
        r = {"metadata": {"name": "my-gw", "namespace": "f5-bnk"}}
        assert resource_key(r) == "f5-bnk/my-gw"

    def test_missing_metadata_returns_empty(self):
        assert resource_name({}) == ""
        assert resource_ns({}) == ""
        assert resource_key({}) == "/"

    def test_missing_name_returns_empty(self):
        assert resource_name({"metadata": {}}) == ""

    def test_cluster_scoped_resource(self):
        """Cluster-scoped resources (no namespace) return empty namespace."""
        r = {"metadata": {"name": "f5-bnk"}}
        assert resource_ns(r) == ""
        assert resource_key(r) == "/f5-bnk"


# ---------------------------------------------------------------------------
# has_condition / get_condition_message
# ---------------------------------------------------------------------------


class TestHasCondition:
    def test_condition_present_and_true(self):
        r = {"status": {"conditions": [
            {"type": "Programmed", "status": "True", "message": "OK"},
        ]}}
        assert has_condition(r, "Programmed") is True

    def test_condition_present_but_false(self):
        r = {"status": {"conditions": [
            {"type": "Programmed", "status": "False", "message": "failed"},
        ]}}
        assert has_condition(r, "Programmed") is False

    def test_condition_missing(self):
        r = {"status": {"conditions": [
            {"type": "Accepted", "status": "True"},
        ]}}
        assert has_condition(r, "Programmed") is False

    def test_no_conditions_list(self):
        assert has_condition({"status": {}}, "Programmed") is False
        assert has_condition({}, "Programmed") is False

    def test_null_conditions(self):
        """K8s API can return null for conditions."""
        assert has_condition({"status": {"conditions": None}}, "Programmed") is False

    def test_custom_expected_status(self):
        r = {"status": {"conditions": [
            {"type": "Ready", "status": "False"},
        ]}}
        assert has_condition(r, "Ready", expected="False") is True

    def test_non_dict_input(self):
        assert has_condition("not a dict", "Programmed") is False
        assert has_condition(None, "Programmed") is False

    def test_non_dict_condition_entries_skipped(self):
        r = {"status": {"conditions": ["garbage", 42, None]}}
        assert has_condition(r, "Programmed") is False

    def test_multiple_conditions(self):
        r = {"status": {"conditions": [
            {"type": "Accepted", "status": "True"},
            {"type": "Programmed", "status": "True"},
            {"type": "Ready", "status": "False"},
        ]}}
        assert has_condition(r, "Accepted") is True
        assert has_condition(r, "Programmed") is True
        assert has_condition(r, "Ready") is False


class TestGetConditionMessage:
    def test_message_present(self):
        r = {"status": {"conditions": [
            {"type": "Programmed", "status": "False", "message": "no listeners configured"},
        ]}}
        assert get_condition_message(r, "Programmed") == "no listeners configured"

    def test_condition_without_message_key(self):
        r = {"status": {"conditions": [
            {"type": "Programmed", "status": "True"},
        ]}}
        assert get_condition_message(r, "Programmed") == ""

    def test_missing_condition_type(self):
        r = {"status": {"conditions": [
            {"type": "Accepted", "status": "True", "message": "ok"},
        ]}}
        assert get_condition_message(r, "Programmed") == ""

    def test_empty_resource(self):
        assert get_condition_message({}, "Programmed") == ""

    def test_non_dict_input(self):
        assert get_condition_message("not a dict", "Programmed") == ""


# ---------------------------------------------------------------------------
# calc_severity / rollup_severity
# ---------------------------------------------------------------------------


class TestCalcSeverity:
    def test_all_healthy(self):
        assert calc_severity(3, 3) == "healthy"

    def test_partial(self):
        assert calc_severity(1, 3) == "warning"

    def test_none_healthy(self):
        assert calc_severity(0, 3) == "critical"

    def test_zero_total(self):
        assert calc_severity(0, 0) == "unknown"

    def test_one_of_one(self):
        assert calc_severity(1, 1) == "healthy"


class TestRollupSeverity:
    def test_all_healthy(self):
        assert rollup_severity(["healthy", "healthy", "healthy"]) == "healthy"

    def test_one_warning(self):
        assert rollup_severity(["healthy", "warning", "healthy"]) == "warning"

    def test_one_critical(self):
        assert rollup_severity(["healthy", "warning", "critical"]) == "critical"

    def test_unknown_only(self):
        assert rollup_severity(["unknown", "unknown"]) == "unknown"

    def test_unknown_with_healthy(self):
        """Unknown is worse than healthy."""
        assert rollup_severity(["healthy", "unknown"]) == "unknown"

    def test_empty_list(self):
        assert rollup_severity([]) == "unknown"

    def test_single_element(self):
        assert rollup_severity(["critical"]) == "critical"
        assert rollup_severity(["healthy"]) == "healthy"

    def test_unrecognized_severity_treated_as_unknown(self):
        """Unknown severity strings default to 'unknown' priority."""
        assert rollup_severity(["healthy", "banana"]) == "banana"


# ---------------------------------------------------------------------------
# make_resource_map
# ---------------------------------------------------------------------------


class TestMakeResourceMap:
    def test_builds_lookup(self):
        items = [
            {"metadata": {"name": "gw-1", "namespace": "ns-a"}},
            {"metadata": {"name": "gw-2", "namespace": "ns-b"}},
        ]
        m = make_resource_map(items)
        assert "ns-a/gw-1" in m
        assert "ns-b/gw-2" in m
        assert m["ns-a/gw-1"] is items[0]

    def test_empty_list(self):
        assert make_resource_map([]) == {}

    def test_duplicate_key_last_wins(self):
        """If two resources have the same namespace/name, last one wins."""
        items = [
            {"metadata": {"name": "x", "namespace": "ns"}, "v": 1},
            {"metadata": {"name": "x", "namespace": "ns"}, "v": 2},
        ]
        m = make_resource_map(items)
        assert m["ns/x"]["v"] == 2


# ---------------------------------------------------------------------------
# BNK_RESOURCE_TYPES constant
# ---------------------------------------------------------------------------


class TestBnkResourceTypes:
    def test_is_non_empty_list(self):
        assert isinstance(BNK_RESOURCE_TYPES, list)
        assert len(BNK_RESOURCE_TYPES) > 0

    def test_includes_core_types(self):
        assert "gateway" in BNK_RESOURCE_TYPES
        assert "httproute" in BNK_RESOURCE_TYPES
        assert "service" in BNK_RESOURCE_TYPES
        assert "f5spkvlan" in BNK_RESOURCE_TYPES
        assert "cneinstance" in BNK_RESOURCE_TYPES

    def test_no_duplicates(self):
        assert len(BNK_RESOURCE_TYPES) == len(set(BNK_RESOURCE_TYPES))


# ---------------------------------------------------------------------------
# _resolve_flo_version_to_bnk
# ---------------------------------------------------------------------------


class TestResolveFloVersionToBnk:
    def test_flo_230_patch_resolves_to_241(self):
        assert _resolve_flo_version_to_bnk("2.30.0-0.11.4") == "2.4.1"
        assert _resolve_flo_version_to_bnk("v2.30.0-0.11.4") == "2.4.1"

    def test_flo_2301_resolves_to_241(self):
        assert _resolve_flo_version_to_bnk("2.30.1-0.0.8") == "2.4.1"
        assert _resolve_flo_version_to_bnk("v2.30.1") == "2.4.1"

    def test_flo_230_base_resolves_to_24(self):
        assert _resolve_flo_version_to_bnk("2.30.0-0.5.2") == "2.4"
        assert _resolve_flo_version_to_bnk("v2.30.0") == "2.4"

    def test_flo_221_resolves_to_23(self):
        assert _resolve_flo_version_to_bnk("2.21.13-0.0.28") == "2.3"
        assert _resolve_flo_version_to_bnk("v2.21.13") == "2.3"

    def test_flo_29_resolves_to_22(self):
        assert _resolve_flo_version_to_bnk("2.9.27") == "2.2"
        assert _resolve_flo_version_to_bnk("v2.9.27") == "2.2"

    def test_flo_1198_resolves_to_21(self):
        assert _resolve_flo_version_to_bnk("1.198.4-0.1.36") == "2.1"
        assert _resolve_flo_version_to_bnk("v1.198.4") == "2.1"

    def test_direct_semver_passthrough(self):
        assert _resolve_flo_version_to_bnk("2.5.0") == "2.5.0"
        assert _resolve_flo_version_to_bnk("v2.5.0") == "2.5.0"
        assert _resolve_flo_version_to_bnk("1.8.0") == "1.8.0"

    def test_internal_tmos_major_version_filtered(self):
        assert _resolve_flo_version_to_bnk("10.204.15-0.6.0") is None
        assert _resolve_flo_version_to_bnk("v14.91.12-0.18.0") is None

    def test_empty_or_none(self):
        assert _resolve_flo_version_to_bnk("") is None
        assert _resolve_flo_version_to_bnk(None) is None


# ---------------------------------------------------------------------------
# extract_bnk_version
# ---------------------------------------------------------------------------


class TestExtractBnkVersion:
    def test_live_cluster_pod_shape_resolves_to_241(self):
        """Live cluster 51 scenario: TMM pod contains blobd (v1.25.5), FLO pod has v2.30.0-0.11.4."""
        data = {
            "classified_pods": {
                "tmm": [
                    {
                        "name": "f5-tmm-6v47c",
                        "containers": [
                            {"name": "blobd", "image": "repo.f5.com/images/f5-blobd:v1.25.5-0.0.8"},
                            {"name": "debug", "image": "repo.f5.com/images/f5-debug-sidecar:v10.146.1-0.0.116"},
                            {"name": "f5-fluentbit", "image": "repo.f5.com/images/f5-fluentbit:v1.6.8-0.0.3"},
                            {"name": "f5-tmm", "image": "repo.f5.com/images/tmm-img:v10.204.15-0.6.0"},
                            {"name": "f5-tmm-routing", "image": "repo.f5.com/images/f5dr-img:v3.33.7-0.0.9"},
                            {"name": "f5-tmm-tmrouted", "image": "repo.f5.com/images/tmrouted-img:v2.25.7-0.0.6"},
                            {"name": "observer", "image": "repo.f5.com/images/f5-toda-observer:v5.36.5-0.3.4"},
                        ],
                    }
                ],
                "flo": [
                    {
                        "name": "f5-lifecycle-operator-d76cc756b-f64fc",
                        "containers": [
                            {
                                "name": "f5-lifecycle-operator",
                                "image": "repo.f5.com/images/f5-lifecycle-operator:v2.30.0-0.11.4",
                            }
                        ],
                    }
                ],
                "controller": [
                    {
                        "name": "f5-cne-controller-7d695f8585-gs7r9",
                        "containers": [
                            {"name": "f5-cne-controller", "image": "repo.f5.com/images/f5ingress:v14.91.12-0.18.0"},
                            {"name": "f5-fluentbit", "image": "repo.f5.com/images/f5-fluentbit:v1.6.8-0.0.3"},
                            {"name": "f5-tmm-pod-manager", "image": "repo.f5.com/images/f5ing-tmm-pod-manager:v1.10.11-0.0.7"},
                        ],
                    }
                ],
            }
        }
        assert extract_bnk_version(data) == "2.4.1"

    def test_prioritizes_flo_over_tmm(self):
        data = {
            "classified_pods": {
                "tmm": [
                    {"name": "f5-tmm-a", "containers": [{"name": "tmm", "image": "f5/spk-tmm:v2.4.0"}]}
                ],
                "flo": [
                    {"name": "flo-operator", "containers": [{"name": "flo", "image": "f5/f5-lifecycle-operator:v2.30.0-0.11.4"}]}
                ],
            }
        }
        assert extract_bnk_version(data) == "2.4.1"

    def test_ignores_sidecars_in_tmm(self):
        """When TMM pod only has blobd/debug/observer, blobd's version is NOT returned."""
        data = {
            "classified_pods": {
                "tmm": [
                    {
                        "name": "f5-tmm-a",
                        "containers": [
                            {"name": "blobd", "image": "repo.f5.com/images/f5-blobd:v1.25.5-0.0.8"},
                            {"name": "debug", "image": "repo.f5.com/images/f5-debug:v10.146.1"},
                            {"name": "observer", "image": "repo.f5.com/images/observer:v5.36.5"},
                        ],
                    }
                ]
            }
        }
        assert extract_bnk_version(data) is None

    def test_fallback_to_controller_or_tmm_when_no_flo(self):
        data = {
            "classified_pods": {
                "tmm": [
                    {"name": "f5-tmm-a", "containers": [{"name": "tmm", "image": "f5/spk-tmm:v2.4.1"}]}
                ]
            }
        }
        assert extract_bnk_version(data) == "2.4.1"

    def test_accepts_direct_classified_pods_dict(self):
        classified = {
            "flo": [
                {"name": "flo", "containers": [{"name": "flo", "image": "repo.f5.com/flo:v2.30.1-0.0.8"}]}
            ]
        }
        assert extract_bnk_version(classified) == "2.4.1"

    def test_empty_and_invalid_inputs(self):
        assert extract_bnk_version(None) is None
        assert extract_bnk_version({}) is None
        assert extract_bnk_version({"classified_pods": None}) is None
        assert extract_bnk_version({"classified_pods": "invalid"}) is None
        assert extract_bnk_version({"classified_pods": {"flo": []}}) is None
