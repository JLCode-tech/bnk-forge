package bootstrap

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// BootstrapCredentials holds the cryptographic identity for mTLS.
type BootstrapCredentials struct {
	ClusterUUID  string
	NodeName     string
	SPIFFEID     string
	CertPEM      []byte
	KeyPEM       []byte
	CAPEM        []byte
	CertPath     string
	KeyPath      string
	CAPath       string
	ExpiresAt    time.Time
}

// Config configures the bootstrap client.
type Config struct {
	ConsoleURL         string
	EnrollmentToken    string
	ClusterName        string
	ClusterUUID        string
	NodeName           string
	CertDir            string
	InsecureSkipVerify bool
	RoundTripper       http.RoundTripper
	Timeout            time.Duration
}

// Client manages agent enrollment and mTLS certificate lifecycle.
type Client struct {
	cfg        Config
	httpClient *http.Client
}

// NewClient creates a new bootstrap client.
func NewClient(cfg Config) *Client {
	if cfg.ConsoleURL == "" {
		cfg.ConsoleURL = "https://console:17543"
	}
	if cfg.NodeName == "" {
		cfg.NodeName = "node-01"
	}
	if cfg.Timeout <= 0 {
		cfg.Timeout = 15 * time.Second
	}

	var transport http.RoundTripper
	if cfg.RoundTripper != nil {
		transport = cfg.RoundTripper
	} else {
		transport = &http.Transport{
			TLSClientConfig: &tls.Config{
				InsecureSkipVerify: cfg.InsecureSkipVerify,
			},
		}
	}

	return &Client{
		cfg: cfg,
		httpClient: &http.Client{
			Transport: transport,
			Timeout:   cfg.Timeout,
		},
	}
}

// Bootstrap coordinates obtaining or loading mTLS certificates.
func (c *Client) Bootstrap(ctx context.Context) (*BootstrapCredentials, error) {
	// 1. Try loading cached certificates from disk
	if c.cfg.CertDir != "" {
		creds, err := c.loadCachedCredentials()
		if err == nil && creds != nil {
			// Ensure certificate is not expired or expiring soon (within 24h)
			if time.Until(creds.ExpiresAt) > 24*time.Hour {
				return creds, nil
			}
		}
	}

	// 2. Perform enrollment handshake if token is provided
	if c.cfg.EnrollmentToken == "" {
		return nil, fmt.Errorf("no valid certificates found in %s and no enrollment token provided", c.cfg.CertDir)
	}

	return c.enroll(ctx)
}

// enroll generates a new ECDSA key and CSR, submitting to /api/fleet/enrollment/bootstrap.
func (c *Client) enroll(ctx context.Context) (*BootstrapCredentials, error) {
	key, keyPEM, err := generateECDSAPrivateKey()
	if err != nil {
		return nil, fmt.Errorf("generating private key: %w", err)
	}

	csrPEM, err := generateCSR(key, c.cfg.ClusterUUID, c.cfg.NodeName)
	if err != nil {
		return nil, fmt.Errorf("generating CSR: %w", err)
	}

	payload := map[string]interface{}{
		"token":               c.cfg.EnrollmentToken,
		"csr":                 string(csrPEM),
		"cluster_uuid":        c.cfg.ClusterUUID,
		"node_name":           c.cfg.NodeName,
		"machine_fingerprint": getMachineFingerprint(),
	}

	data, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("marshaling bootstrap request: %w", err)
	}

	endpoint := fmt.Sprintf("%s/api/fleet/enrollment/bootstrap", strings.TrimRight(c.cfg.ConsoleURL, "/"))
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("creating bootstrap request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", c.cfg.EnrollmentToken))

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("bootstrap request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return nil, fmt.Errorf("bootstrap rejected by console (status %d): %s", resp.StatusCode, string(body))
	}

	var res struct {
		Status        string `json:"status"`
		Certificate   string `json:"certificate"`
		CACertificate string `json:"ca_certificate"`
		ClusterUUID   string `json:"cluster_uuid"`
		SPIFFEID      string `json:"spiffe_id"`
		ExpiresAt     string `json:"expires_at"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&res); err != nil {
		return nil, fmt.Errorf("decoding bootstrap response: %w", err)
	}

	expiresAt, _ := time.Parse(time.RFC3339, res.ExpiresAt)
	if expiresAt.IsZero() {
		// Default fallback 30 days
		expiresAt = time.Now().Add(30 * 24 * time.Hour)
	}

	creds := &BootstrapCredentials{
		ClusterUUID: res.ClusterUUID,
		NodeName:    c.cfg.NodeName,
		SPIFFEID:    res.SPIFFEID,
		CertPEM:     []byte(res.Certificate),
		KeyPEM:      keyPEM,
		CAPEM:       []byte(res.CACertificate),
		ExpiresAt:   expiresAt,
	}

	// Persist to disk if cert directory is configured
	if c.cfg.CertDir != "" {
		if err := c.persistCredentials(creds); err != nil {
			return nil, fmt.Errorf("persisting credentials: %w", err)
		}
	}

	return creds, nil
}

func (c *Client) persistCredentials(creds *BootstrapCredentials) error {
	if err := os.MkdirAll(c.cfg.CertDir, 0700); err != nil {
		return err
	}

	certPath := filepath.Join(c.cfg.CertDir, "tls.crt")
	keyPath := filepath.Join(c.cfg.CertDir, "tls.key")
	caPath := filepath.Join(c.cfg.CertDir, "ca.crt")

	if err := os.WriteFile(certPath, creds.CertPEM, 0644); err != nil {
		return err
	}
	if err := os.WriteFile(keyPath, creds.KeyPEM, 0600); err != nil {
		return err
	}
	if err := os.WriteFile(caPath, creds.CAPEM, 0644); err != nil {
		return err
	}

	creds.CertPath = certPath
	creds.KeyPath = keyPath
	creds.CAPath = caPath
	return nil
}

func (c *Client) loadCachedCredentials() (*BootstrapCredentials, error) {
	certPath := filepath.Join(c.cfg.CertDir, "tls.crt")
	keyPath := filepath.Join(c.cfg.CertDir, "tls.key")
	caPath := filepath.Join(c.cfg.CertDir, "ca.crt")

	certPEM, err := os.ReadFile(certPath)
	if err != nil {
		return nil, err
	}
	keyPEM, err := os.ReadFile(keyPath)
	if err != nil {
		return nil, err
	}
	caPEM, err := os.ReadFile(caPath)
	if err != nil {
		return nil, err
	}

	// Parse cert to extract validity and SPIFFE SAN
	block, _ := pem.Decode(certPEM)
	if block == nil {
		return nil, fmt.Errorf("failed decoding cert PEM")
	}
	cert, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("parsing cert: %w", err)
	}

	var spiffeID string
	for _, uri := range cert.URIs {
		if strings.HasPrefix(uri.String(), "spiffe://forge/cluster/") {
			spiffeID = uri.String()
			break
		}
	}

	return &BootstrapCredentials{
		ClusterUUID: c.cfg.ClusterUUID,
		NodeName:    c.cfg.NodeName,
		SPIFFEID:    spiffeID,
		CertPEM:     certPEM,
		KeyPEM:      keyPEM,
		CAPEM:       caPEM,
		CertPath:    certPath,
		KeyPath:     keyPath,
		CAPath:      caPath,
		ExpiresAt:   cert.NotAfter,
	}, nil
}

func generateECDSAPrivateKey() (*ecdsa.PrivateKey, []byte, error) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, nil, err
	}

	der, err := x509.MarshalECPrivateKey(key)
	if err != nil {
		return nil, nil, err
	}

	pemBytes := pem.EncodeToMemory(&pem.Block{
		Type:  "EC PRIVATE KEY",
		Bytes: der,
	})

	return key, pemBytes, nil
}

func generateCSR(key *ecdsa.PrivateKey, clusterUUID, nodeName string) ([]byte, error) {
	cn := fmt.Sprintf("forge-agent-%s-%s", clusterUUID, nodeName)
	if clusterUUID == "" {
		cn = fmt.Sprintf("forge-agent-%s", nodeName)
	}

	template := x509.CertificateRequest{
		Subject: pkix.Name{
			CommonName:   cn,
			Organization: []string{"BNK Forge"},
		},
		SignatureAlgorithm: x509.ECDSAWithSHA256,
	}

	csrDER, err := x509.CreateCertificateRequest(rand.Reader, &template, key)
	if err != nil {
		return nil, err
	}

	return pem.EncodeToMemory(&pem.Block{
		Type:  "CERTIFICATE REQUEST",
		Bytes: csrDER,
	}), nil
}

func getMachineFingerprint() string {
	hostname, _ := os.Hostname()
	hash := sha256.Sum256([]byte(fmt.Sprintf("%s-%d", hostname, os.Getpid())))
	return hex.EncodeToString(hash[:16])
}
