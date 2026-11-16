package transport

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/JLCode-tech/bnk-forge/pkg/protocol"
)

// HTTPTransportConfig configures the HTTP/mTLS transport.
type HTTPTransportConfig struct {
	BaseURL            string
	TLSCertFile        string
	TLSKeyFile         string
	CACertFile         string
	TLSCertData        []byte
	TLSKeyData         []byte
	CACertData         []byte
	InsecureSkipVerify bool
	Timeout            time.Duration
	RoundTripper       http.RoundTripper
}

// HTTPTransport implements Transport over HTTP/1.1 and HTTP/2 with mTLS support.
type HTTPTransport struct {
	baseURL    string
	httpClient *http.Client
}

// NewHTTPTransport creates a new HTTPTransport client.
func NewHTTPTransport(cfg HTTPTransportConfig) (*HTTPTransport, error) {
	baseURL := strings.TrimRight(cfg.BaseURL, "/")
	if baseURL == "" {
		baseURL = "http://localhost:17543"
	}

	timeout := cfg.Timeout
	if timeout <= 0 {
		timeout = 10 * time.Second
	}

	var transport http.RoundTripper
	if cfg.RoundTripper != nil {
		transport = cfg.RoundTripper
	} else {
		tlsConfig, err := buildClientTLSConfig(cfg)
		if err != nil {
			return nil, fmt.Errorf("failed building client TLS config: %w", err)
		}

		transport = &http.Transport{
			TLSClientConfig:     tlsConfig,
			MaxIdleConns:        50,
			MaxIdleConnsPerHost: 10,
			IdleConnTimeout:     60 * time.Second,
		}
	}

	client := &http.Client{
		Transport: transport,
		Timeout:   timeout,
	}

	return &HTTPTransport{
		baseURL:    baseURL,
		httpClient: client,
	}, nil
}

// StreamBatch transmits a batch of telemetry records to the Ingest Gateway.
func (t *HTTPTransport) StreamBatch(ctx context.Context, batch *protocol.TelemetryBatch) error {
	data, err := json.Marshal(batch)
	if err != nil {
		return fmt.Errorf("failed marshaling telemetry batch: %w", err)
	}

	endpoint := fmt.Sprintf("%s/api/v1/telemetry/batch", t.baseURL)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(data))
	if err != nil {
		return fmt.Errorf("failed creating batch request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := t.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("batch transmission failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusAccepted {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return fmt.Errorf("batch rejected by server (status %d): %s", resp.StatusCode, string(body))
	}

	return nil
}

// Register performs the initial handshake to announce presence and receive configuration.
func (t *HTTPTransport) Register(ctx context.Context, req *protocol.RegisterRequest) (*protocol.RegisterResponse, error) {
	data, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("failed marshaling register request: %w", err)
	}

	endpoint := fmt.Sprintf("%s/api/v1/telemetry/register", t.baseURL)
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("failed creating register request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := t.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("registration request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return nil, fmt.Errorf("registration rejected (status %d): %s", resp.StatusCode, string(body))
	}

	var regResp protocol.RegisterResponse
	if err := json.NewDecoder(resp.Body).Decode(&regResp); err != nil {
		return nil, fmt.Errorf("failed decoding register response: %w", err)
	}

	return &regResp, nil
}

// SendHeartbeat sends an uptime/liveness ping and receives acknowledgment.
func (t *HTTPTransport) SendHeartbeat(ctx context.Context, ping *protocol.Ping) (*protocol.Pong, error) {
	data, err := json.Marshal(ping)
	if err != nil {
		return nil, fmt.Errorf("failed marshaling ping: %w", err)
	}

	endpoint := fmt.Sprintf("%s/api/v1/telemetry/heartbeat", t.baseURL)
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("failed creating heartbeat request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := t.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("heartbeat request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return nil, fmt.Errorf("heartbeat rejected (status %d): %s", resp.StatusCode, string(body))
	}

	var pong protocol.Pong
	if err := json.NewDecoder(resp.Body).Decode(&pong); err != nil {
		return nil, fmt.Errorf("failed decoding heartbeat response: %w", err)
	}

	return &pong, nil
}

// Ping checks if the Ingest Gateway healthz endpoint is reachable.
func (t *HTTPTransport) Ping(ctx context.Context) error {
	endpoint := fmt.Sprintf("%s/healthz", t.baseURL)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return err
	}

	resp, err := t.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("healthz returned status %d", resp.StatusCode)
	}
	return nil
}

// Close cleanly terminates the transport connection.
func (t *HTTPTransport) Close() error {
	t.httpClient.CloseIdleConnections()
	return nil
}

func buildClientTLSConfig(cfg HTTPTransportConfig) (*tls.Config, error) {
	tlsConfig := &tls.Config{
		InsecureSkipVerify: cfg.InsecureSkipVerify,
		MinVersion:         tls.VersionTLS12,
	}

	// Load CA certificates
	var caBytes []byte
	if len(cfg.CACertData) > 0 {
		caBytes = cfg.CACertData
	} else if cfg.CACertFile != "" {
		var err error
		caBytes, err = os.ReadFile(cfg.CACertFile)
		if err != nil {
			return nil, fmt.Errorf("reading CA file: %w", err)
		}
	}

	if len(caBytes) > 0 {
		pool := x509.NewCertPool()
		if !pool.AppendCertsFromPEM(caBytes) {
			return nil, fmt.Errorf("failed appending CA certs to pool")
		}
		tlsConfig.RootCAs = pool
	}

	// Load client certificate for mTLS
	var cert tls.Certificate
	var hasCert bool

	if len(cfg.TLSCertData) > 0 && len(cfg.TLSKeyData) > 0 {
		var err error
		cert, err = tls.X509KeyPair(cfg.TLSCertData, cfg.TLSKeyData)
		if err != nil {
			return nil, fmt.Errorf("parsing client keypair from memory: %w", err)
		}
		hasCert = true
	} else if cfg.TLSCertFile != "" && cfg.TLSKeyFile != "" {
		var err error
		cert, err = tls.LoadX509KeyPair(cfg.TLSCertFile, cfg.TLSKeyFile)
		if err != nil {
			return nil, fmt.Errorf("loading client keypair from file: %w", err)
		}
		hasCert = true
	}

	if hasCert {
		tlsConfig.Certificates = []tls.Certificate{cert}
	}

	return tlsConfig, nil
}
