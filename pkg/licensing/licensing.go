package licensing

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"sort"
	"strings"
	"time"
)

// DefaultEmbeddedPublicKeyB64 is the canonical Ed25519 public key for BNK Forge PoV.
const DefaultEmbeddedPublicKeyB64 = "0SnG6ca30gpWEIgoiHRkMuYLDaW953FcimK5jdNE9JA="

// DefaultGracePeriodDays is the standard post-expiry grace period.
const DefaultGracePeriodDays = 30

// ClockDriftToleranceSeconds allows a 5-minute clock skew across distributed edge nodes.
const ClockDriftToleranceSeconds = 300

// LicenseStatus represents the temporal and cryptographic health of a license.
type LicenseStatus string

const (
	StatusValid            LicenseStatus = "VALID"
	StatusGracePeriod      LicenseStatus = "GRACE_PERIOD"
	StatusExpired          LicenseStatus = "EXPIRED"
	StatusInvalidSignature LicenseStatus = "INVALID_SIGNATURE"
	StatusNotYetValid      LicenseStatus = "NOT_YET_VALID"
	StatusCorrupted        LicenseStatus = "CORRUPTED"
	StatusUnlicensed       LicenseStatus = "UNLICENSED"
)

// LicenseEnvelope is the top-level structure of a forge.lic file.
type LicenseEnvelope struct {
	Payload   map[string]interface{} `json:"payload"`
	Signature string                 `json:"signature"`
}

// LicensePayload contains parsed metadata and capacity quotas.
type LicensePayload struct {
	LicenseID       string                 `json:"license_id"`
	Customer        string                 `json:"customer"`
	Tier            string                 `json:"tier"`
	IssuedAt        int64                  `json:"issued_at"`
	ExpiresAt       int64                  `json:"expires_at"`
	GracePeriodDays int                    `json:"grace_period_days"`
	MaxClusters     int                    `json:"max_clusters"`
	MaxNodes        int                    `json:"max_nodes"`
	Features        []string               `json:"features"`
	Metadata        map[string]interface{} `json:"metadata,omitempty"`
}

// VerificationResult summarizes the validation outcome.
type VerificationResult struct {
	Status             LicenseStatus          `json:"status"`
	IsUsable           bool                   `json:"is_usable"`
	Customer           string                 `json:"customer,omitempty"`
	Tier               string                 `json:"tier,omitempty"`
	LicenseID          string                 `json:"license_id,omitempty"`
	IssuedAt           int64                  `json:"issued_at,omitempty"`
	ExpiresAt          int64                  `json:"expires_at,omitempty"`
	DaysRemaining      int                    `json:"days_remaining"`
	GraceDaysRemaining int                    `json:"grace_days_remaining"`
	GracePeriodActive  bool                   `json:"grace_period_active"`
	MaxClusters        int                    `json:"max_clusters"`
	MaxNodes           int                    `json:"max_nodes"`
	Features           []string               `json:"features"`
	Metadata           map[string]interface{} `json:"metadata,omitempty"`
	WarningMessage     string                 `json:"warning_message,omitempty"`
	ErrorMessage       string                 `json:"error_message,omitempty"`
}

// CanonicalizePayload produces deterministic canonical JSON bytes matching Python json.dumps(sort_keys=True, separators=(',', ':')).
func CanonicalizePayload(v interface{}) ([]byte, error) {
	switch val := v.(type) {
	case map[string]interface{}:
		keys := make([]string, 0, len(val))
		for k := range val {
			keys = append(keys, k)
		}
		sort.Strings(keys)

		var sb strings.Builder
		sb.WriteString("{")
		for i, k := range keys {
			if i > 0 {
				sb.WriteString(",")
			}
			keyBytes, err := json.Marshal(k)
			if err != nil {
				return nil, err
			}
			sb.Write(keyBytes)
			sb.WriteString(":")
			valBytes, err := CanonicalizePayload(val[k])
			if err != nil {
				return nil, err
			}
			sb.Write(valBytes)
		}
		sb.WriteString("}")
		return []byte(sb.String()), nil

	case []interface{}:
		var sb strings.Builder
		sb.WriteString("[")
		for i, elem := range val {
			if i > 0 {
				sb.WriteString(",")
			}
			elemBytes, err := CanonicalizePayload(elem)
			if err != nil {
				return nil, err
			}
			sb.Write(elemBytes)
		}
		sb.WriteString("]")
		return []byte(sb.String()), nil

	default:
		return json.Marshal(val)
	}
}

// VerifyLicense validates a raw forge.lic JSON envelope against the Ed25519 public key.
func VerifyLicense(raw []byte, pubKeyB64 string, nowUnix int64) (*VerificationResult, error) {
	if pubKeyB64 == "" {
		pubKeyB64 = DefaultEmbeddedPublicKeyB64
	}
	pubBytes, err := base64.StdEncoding.DecodeString(pubKeyB64)
	if err != nil || len(pubBytes) != ed25519.PublicKeySize {
		return &VerificationResult{
			Status:       StatusCorrupted,
			IsUsable:     false,
			ErrorMessage: "Invalid Ed25519 public key encoding",
		}, errors.New("invalid public key")
	}
	pubKey := ed25519.PublicKey(pubBytes)

	var env LicenseEnvelope
	if err := json.Unmarshal(raw, &env); err != nil {
		return &VerificationResult{
			Status:       StatusCorrupted,
			IsUsable:     false,
			ErrorMessage: fmt.Sprintf("Failed decoding license envelope: %v", err),
		}, err
	}

	if env.Payload == nil || env.Signature == "" {
		return &VerificationResult{
			Status:       StatusCorrupted,
			IsUsable:     false,
			ErrorMessage: "Missing payload or signature in license envelope",
		}, errors.New("missing payload or signature")
	}

	sigBytes, err := base64.StdEncoding.DecodeString(env.Signature)
	if err != nil || len(sigBytes) != ed25519.SignatureSize {
		return &VerificationResult{
			Status:       StatusInvalidSignature,
			IsUsable:     false,
			ErrorMessage: "Malformed signature format",
		}, errors.New("malformed signature")
	}

	// Canonical payload verification
	canonical, err := CanonicalizePayload(env.Payload)
	if err != nil {
		return &VerificationResult{
			Status:       StatusCorrupted,
			IsUsable:     false,
			ErrorMessage: fmt.Sprintf("Failed canonicalizing payload: %v", err),
		}, err
	}

	if !ed25519.Verify(pubKey, canonical, sigBytes) {
		return &VerificationResult{
			Status:       StatusInvalidSignature,
			IsUsable:     false,
			ErrorMessage: "Cryptographic signature mismatch",
		}, errors.New("signature mismatch")
	}

	// Parse payload fields
	payloadBytes, _ := json.Marshal(env.Payload)
	var p LicensePayload
	_ = json.Unmarshal(payloadBytes, &p)

	if p.GracePeriodDays <= 0 {
		p.GracePeriodDays = DefaultGracePeriodDays
	}

	if nowUnix <= 0 {
		nowUnix = time.Now().Unix()
	}

	drift := int64(ClockDriftToleranceSeconds)

	// Check future issue date
	if p.IssuedAt > (nowUnix + drift) {
		return &VerificationResult{
			Status:       StatusNotYetValid,
			IsUsable:     false,
			Customer:     p.Customer,
			Tier:         p.Tier,
			LicenseID:    p.LicenseID,
			IssuedAt:     p.IssuedAt,
			ExpiresAt:    p.ExpiresAt,
			MaxClusters:  p.MaxClusters,
			MaxNodes:     p.MaxNodes,
			Features:     p.Features,
			Metadata:     p.Metadata,
			ErrorMessage: fmt.Sprintf("License not yet active: issued at %d", p.IssuedAt),
		}, nil
	}

	// Valid and active
	if nowUnix <= (p.ExpiresAt + drift) {
		daysLeft := int((p.ExpiresAt - nowUnix) / 86400)
		if daysLeft < 0 {
			daysLeft = 0
		}
		return &VerificationResult{
			Status:             StatusValid,
			IsUsable:           true,
			Customer:           p.Customer,
			Tier:               p.Tier,
			LicenseID:          p.LicenseID,
			IssuedAt:           p.IssuedAt,
			ExpiresAt:          p.ExpiresAt,
			DaysRemaining:      daysLeft,
			GraceDaysRemaining: p.GracePeriodDays,
			GracePeriodActive:  false,
			MaxClusters:        p.MaxClusters,
			MaxNodes:           p.MaxNodes,
			Features:           p.Features,
			Metadata:           p.Metadata,
		}, nil
	}

	// Grace period evaluation
	graceLimit := p.ExpiresAt + int64(p.GracePeriodDays*86400)
	if nowUnix <= (graceLimit + drift) {
		graceDaysLeft := int((graceLimit - nowUnix) / 86400)
		if graceDaysLeft < 1 {
			graceDaysLeft = 1
		}
		return &VerificationResult{
			Status:             StatusGracePeriod,
			IsUsable:           true,
			Customer:           p.Customer,
			Tier:               p.Tier,
			LicenseID:          p.LicenseID,
			IssuedAt:           p.IssuedAt,
			ExpiresAt:          p.ExpiresAt,
			DaysRemaining:      0,
			GraceDaysRemaining: graceDaysLeft,
			GracePeriodActive:  true,
			MaxClusters:        p.MaxClusters,
			MaxNodes:           p.MaxNodes,
			Features:           p.Features,
			Metadata:           p.Metadata,
			WarningMessage:     fmt.Sprintf("License expired; operating in %d-day grace period (%d days remaining)", p.GracePeriodDays, graceDaysLeft),
		}, nil
	}

	// Fully expired
	return &VerificationResult{
		Status:             StatusExpired,
		IsUsable:           false,
		Customer:           p.Customer,
		Tier:               p.Tier,
		LicenseID:          p.LicenseID,
		IssuedAt:           p.IssuedAt,
		ExpiresAt:          p.ExpiresAt,
		DaysRemaining:      0,
		GraceDaysRemaining: 0,
		GracePeriodActive:  false,
		MaxClusters:        p.MaxClusters,
		MaxNodes:           p.MaxNodes,
		Features:           p.Features,
		Metadata:           p.Metadata,
		ErrorMessage:       fmt.Sprintf("License and %d-day grace period have expired", p.GracePeriodDays),
	}, nil
}

// VerifyLicenseFile loads and validates a license from a file path.
func VerifyLicenseFile(path string, pubKeyB64 string) (*VerificationResult, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return &VerificationResult{
			Status:       StatusUnlicensed,
			IsUsable:     false,
			ErrorMessage: fmt.Sprintf("License file not found: %v", err),
		}, err
	}
	return VerifyLicense(data, pubKeyB64, time.Now().Unix())
}

// ValidateQuota checks if current cluster and node counts exceed license quotas.
func ValidateQuota(res *VerificationResult, clusters, nodes int) (bool, string) {
	if res == nil || !res.IsUsable {
		return false, "Platform unlicensed or expired"
	}
	if res.MaxClusters > 0 && clusters > res.MaxClusters {
		return false, fmt.Sprintf("Cluster quota exceeded: licensed for %d, tracking %d", res.MaxClusters, clusters)
	}
	if res.MaxNodes > 0 && nodes > res.MaxNodes {
		return false, fmt.Sprintf("Node quota exceeded: licensed for %d, tracking %d", res.MaxNodes, nodes)
	}
	return true, ""
}

// IsFeatureEnabled verifies if a specific feature entitlement is present.
func IsFeatureEnabled(res *VerificationResult, feature string) bool {
	if res == nil || !res.IsUsable {
		return false
	}
	for _, f := range res.Features {
		if f == "*" || f == "all" || strings.EqualFold(f, feature) {
			return true
		}
	}
	return false
}
