package bootstrap

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"math/big"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"sync/atomic"
	"testing"
	"time"
)

type roundTripperFunc func(*http.Request) (*http.Response, error)

func (f roundTripperFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

func generateTestCA(t *testing.T) (*ecdsa.PrivateKey, *x509.Certificate, []byte) {
	caKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("GenerateKey failed: %v", err)
	}

	caTemplate := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject: pkix.Name{
			CommonName:   "Forge Test Root CA",
			Organization: []string{"BNK Forge"},
		},
		NotBefore:             time.Now().Add(-1 * time.Hour),
		NotAfter:              time.Now().Add(24 * time.Hour),
		IsCA:                  true,
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageCRLSign,
		BasicConstraintsValid: true,
	}

	caDER, err := x509.CreateCertificate(rand.Reader, caTemplate, caTemplate, &caKey.PublicKey, caKey)
	if err != nil {
		t.Fatalf("CreateCertificate failed: %v", err)
	}

	caCert, err := x509.ParseCertificate(caDER)
	if err != nil {
		t.Fatalf("ParseCertificate failed: %v", err)
	}

	caPEM := pem.EncodeToMemory(&pem.Block{
		Type:  "CERTIFICATE",
		Bytes: caDER,
	})

	return caKey, caCert, caPEM
}

func signCSRWithCA(t *testing.T, caKey *ecdsa.PrivateKey, caCert *x509.Certificate, csrPEM []byte, clusterUUID string) []byte {
	block, _ := pem.Decode(csrPEM)
	if block == nil {
		t.Fatalf("failed decoding CSR PEM")
	}

	csr, err := x509.ParseCertificateRequest(block.Bytes)
	if err != nil {
		t.Fatalf("ParseCertificateRequest failed: %v", err)
	}

	spiffeURI, _ := url.Parse("spiffe://forge/cluster/" + clusterUUID)

	certTemplate := &x509.Certificate{
		SerialNumber: big.NewInt(100),
		Subject:      csr.Subject,
		NotBefore:    time.Now().Add(-1 * time.Minute),
		NotAfter:     time.Now().Add(30 * 24 * time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth},
		URIs:         []*url.URL{spiffeURI},
	}

	certDER, err := x509.CreateCertificate(rand.Reader, certTemplate, caCert, csr.PublicKey, caKey)
	if err != nil {
		t.Fatalf("sign CreateCertificate failed: %v", err)
	}

	return pem.EncodeToMemory(&pem.Block{
		Type:  "CERTIFICATE",
		Bytes: certDER,
	})
}

func TestAgentBootstrapAndCaching(t *testing.T) {
	caKey, caCert, caPEM := generateTestCA(t)
	var bootstrapCalls int32

	clusterUUID := "c-9999-uuid"
	validToken := "frg_enr_testtoken123"

	// Mock HTTP server
	rt := roundTripperFunc(func(req *http.Request) (*http.Response, error) {
		rec := httptest.NewRecorder()

		if req.URL.Path == "/api/fleet/enrollment/bootstrap" {
			atomic.AddInt32(&bootstrapCalls, 1)

			auth := req.Header.Get("Authorization")
			if auth != "Bearer "+validToken {
				http.Error(rec, "unauthorized", http.StatusUnauthorized)
				resp := rec.Result()
				resp.Request = req
				return resp, nil
			}

			var payload struct {
				Token       string `json:"token"`
				CSR         string `json:"csr"`
				ClusterUUID string `json:"cluster_uuid"`
				NodeName    string `json:"node_name"`
			}
			_ = json.NewDecoder(req.Body).Decode(&payload)

			certPEM := signCSRWithCA(t, caKey, caCert, []byte(payload.CSR), clusterUUID)

			respData := map[string]interface{}{
				"status":                 "enrolled",
				"certificate":            string(certPEM),
				"ca_certificate":         string(caPEM),
				"cluster_uuid":           clusterUUID,
				"spiffe_id":              "spiffe://forge/cluster/" + clusterUUID,
				"heartbeat_interval_sec": 15,
				"expires_at":             time.Now().Add(30 * 24 * time.Hour).Format(time.RFC3339),
			}

			rec.WriteHeader(http.StatusOK)
			_ = json.NewEncoder(rec).Encode(respData)
			resp := rec.Result()
			resp.Request = req
			return resp, nil
		}

		http.NotFound(rec, req)
		resp := rec.Result()
		resp.Request = req
		return resp, nil
	})

	tempDir, err := os.MkdirTemp("", "bootstrap-test-*")
	if err != nil {
		t.Fatalf("MkdirTemp failed: %v", err)
	}
	defer os.RemoveAll(tempDir)

	client := NewClient(Config{
		ConsoleURL:      "http://in-memory",
		EnrollmentToken: validToken,
		ClusterUUID:     clusterUUID,
		NodeName:        "worker-01",
		CertDir:         tempDir,
		RoundTripper:    rt,
	})

	ctx := context.Background()

	// 1. Initial bootstrap should hit API
	creds, err := client.Bootstrap(ctx)
	if err != nil {
		t.Fatalf("Bootstrap failed: %v", err)
	}

	if creds.ClusterUUID != clusterUUID {
		t.Fatalf("expected cluster UUID %s, got %s", clusterUUID, creds.ClusterUUID)
	}
	if creds.SPIFFEID != "spiffe://forge/cluster/"+clusterUUID {
		t.Fatalf("expected SPIFFE ID spiffe://forge/cluster/%s, got %s", clusterUUID, creds.SPIFFEID)
	}
	if atomic.LoadInt32(&bootstrapCalls) != 1 {
		t.Fatalf("expected 1 bootstrap call, got %d", atomic.LoadInt32(&bootstrapCalls))
	}

	// Verify disk persistence
	if _, err := os.Stat(creds.CertPath); err != nil {
		t.Fatalf("Cert file not found on disk: %v", err)
	}
	if _, err := os.Stat(creds.KeyPath); err != nil {
		t.Fatalf("Key file not found on disk: %v", err)
	}
	if _, err := os.Stat(creds.CAPath); err != nil {
		t.Fatalf("CA file not found on disk: %v", err)
	}

	// 2. Subsequent bootstrap with existing certs should load from cache without calling API
	creds2, err := client.Bootstrap(ctx)
	if err != nil {
		t.Fatalf("Cached Bootstrap failed: %v", err)
	}
	if atomic.LoadInt32(&bootstrapCalls) != 1 {
		t.Fatalf("expected no additional bootstrap calls, still got %d", atomic.LoadInt32(&bootstrapCalls))
	}
	if creds2.SPIFFEID != creds.SPIFFEID {
		t.Fatalf("cached SPIFFE ID mismatch")
	}
}
