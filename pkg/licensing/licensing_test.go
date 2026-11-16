package licensing

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"testing"
	"time"
)

const testPrivateKeyB64 = "qvYZ84ClRBZ5QyV/n9hak+UJ2Jof3KFw1ZZJPG0ZO6c="

func signTestLicense(t *testing.T, payload map[string]interface{}) []byte {
	privBytes, err := base64.StdEncoding.DecodeString(testPrivateKeyB64)
	if err != nil {
		t.Fatalf("failed decoding test private key: %v", err)
	}
	privKey := ed25519.NewKeyFromSeed(privBytes)

	canonical, err := CanonicalizePayload(payload)
	if err != nil {
		t.Fatalf("failed canonicalizing payload: %v", err)
	}

	sig := ed25519.Sign(privKey, canonical)
	sigB64 := base64.StdEncoding.EncodeToString(sig)

	env := LicenseEnvelope{
		Payload:   payload,
		Signature: sigB64,
	}

	data, err := json.Marshal(env)
	if err != nil {
		t.Fatalf("failed marshaling envelope: %v", err)
	}
	return data
}

func TestVerifyLicenseValid(t *testing.T) {
	now := time.Now().Unix()
	payload := map[string]interface{}{
		"license_id":        "lic-pov-viettel-001",
		"customer":          "Viettel Enterprise",
		"tier":              "enterprise-pov",
		"issued_at":         float64(now - 3600),
		"expires_at":        float64(now + 86400*30),
		"grace_period_days": float64(30),
		"max_clusters":      float64(5),
		"max_nodes":         float64(50),
		"features":          []interface{}{"ebpf_flow_analytics", "tmm_dpdk_metrics", "nats_leaf_transport"},
	}

	data := signTestLicense(t, payload)
	res, err := VerifyLicense(data, DefaultEmbeddedPublicKeyB64, now)
	if err != nil {
		t.Fatalf("VerifyLicense failed: %v", err)
	}

	if res.Status != StatusValid {
		t.Errorf("expected StatusValid, got %s", res.Status)
	}
	if !res.IsUsable {
		t.Errorf("expected IsUsable = true")
	}
	if res.Customer != "Viettel Enterprise" {
		t.Errorf("expected customer Viettel Enterprise, got %s", res.Customer)
	}
	if res.DaysRemaining < 29 || res.DaysRemaining > 31 {
		t.Errorf("expected ~30 days remaining, got %d", res.DaysRemaining)
	}
	if res.GracePeriodActive {
		t.Errorf("expected GracePeriodActive = false")
	}

	// Test Quota
	allowed, reason := ValidateQuota(res, 3, 20)
	if !allowed {
		t.Errorf("expected quota to allow 3 clusters / 20 nodes, failed: %s", reason)
	}
	allowed, reason = ValidateQuota(res, 10, 20)
	if allowed {
		t.Errorf("expected cluster quota rejection for 10 clusters")
	}

	// Test Features
	if !IsFeatureEnabled(res, "ebpf_flow_analytics") {
		t.Errorf("expected ebpf_flow_analytics to be enabled")
	}
	if IsFeatureEnabled(res, "unlicensed_quantum_crypto") {
		t.Errorf("expected unlicensed feature to be rejected")
	}
}

func TestVerifyLicenseGracePeriod(t *testing.T) {
	now := time.Now().Unix()
	// Expired 5 days ago, grace period is 30 days
	payload := map[string]interface{}{
		"license_id":        "lic-grace-test",
		"customer":          "Yotta Shakti",
		"tier":              "enterprise-pov",
		"issued_at":         float64(now - 86400*40),
		"expires_at":        float64(now - 86400*5),
		"grace_period_days": float64(30),
		"max_clusters":      float64(10),
		"max_nodes":         float64(100),
		"features":          []interface{}{"tmm_dpdk_metrics"},
	}

	data := signTestLicense(t, payload)
	res, err := VerifyLicense(data, DefaultEmbeddedPublicKeyB64, now)
	if err != nil {
		t.Fatalf("VerifyLicense failed: %v", err)
	}

	if res.Status != StatusGracePeriod {
		t.Errorf("expected StatusGracePeriod, got %s", res.Status)
	}
	if !res.IsUsable {
		t.Errorf("expected license to be usable during grace period")
	}
	if !res.GracePeriodActive {
		t.Errorf("expected GracePeriodActive = true")
	}
	if res.GraceDaysRemaining < 24 || res.GraceDaysRemaining > 26 {
		t.Errorf("expected ~25 grace days remaining, got %d", res.GraceDaysRemaining)
	}
}

func TestVerifyLicenseExpired(t *testing.T) {
	now := time.Now().Unix()
	// Expired 40 days ago, past 30-day grace period
	payload := map[string]interface{}{
		"license_id":        "lic-expired-test",
		"customer":          "NPCI",
		"tier":              "enterprise-pov",
		"issued_at":         float64(now - 86400*100),
		"expires_at":        float64(now - 86400*40),
		"grace_period_days": float64(30),
		"max_clusters":      float64(2),
		"max_nodes":         float64(10),
	}

	data := signTestLicense(t, payload)
	res, err := VerifyLicense(data, DefaultEmbeddedPublicKeyB64, now)
	if err != nil {
		t.Fatalf("VerifyLicense failed: %v", err)
	}

	if res.Status != StatusExpired {
		t.Errorf("expected StatusExpired, got %s", res.Status)
	}
	if res.IsUsable {
		t.Errorf("expected IsUsable = false for expired license")
	}

	allowed, _ := ValidateQuota(res, 1, 1)
	if allowed {
		t.Errorf("expected quota validation to fail on expired license")
	}
}

func TestVerifyLicenseTamperedSignature(t *testing.T) {
	now := time.Now().Unix()
	payload := map[string]interface{}{
		"license_id": "lic-tamper-test",
		"customer":   "Legit Customer",
		"expires_at": float64(now + 86400*10),
	}

	data := signTestLicense(t, payload)

	// Tamper payload after signing
	var env LicenseEnvelope
	_ = json.Unmarshal(data, &env)
	env.Payload["customer"] = "Hacker Organization"
	tamperedBytes, _ := json.Marshal(env)

	res, err := VerifyLicense(tamperedBytes, DefaultEmbeddedPublicKeyB64, now)
	if err == nil {
		t.Errorf("expected error on tampered license")
	}
	if res.Status != StatusInvalidSignature {
		t.Errorf("expected StatusInvalidSignature, got %s", res.Status)
	}
	if res.IsUsable {
		t.Errorf("expected IsUsable = false")
	}
}
