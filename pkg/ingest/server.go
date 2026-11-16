package ingest

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/JLCode-tech/bnk-forge/pkg/protocol"
)

// ServerConfig configures the Ingest Gateway HTTP/mTLS server.
type ServerConfig struct {
	Addr             string
	ClickHouseURL    string
	NATSAddr         string
	BackendURL       string
	BackendTransport http.RoundTripper
	TLSCertFile      string
	TLSKeyFile       string
	ClientCAFile     string
	RequireMTLS      bool
	RingConfig       RingBufferConfig
}

// IngestServer serves HTTP/REST and mTLS telemetry streams.
type IngestServer struct {
	cfg        ServerConfig
	httpServer *http.Server
	chWriter   *ClickHouseWriter
	natsPub    NATSPublisher
	ringBuffer *TelemetryRingBuffer
	mu         sync.RWMutex
	active     bool
}

// NewIngestServer creates a new Ingest Gateway server.
func NewIngestServer(cfg ServerConfig, ch *ClickHouseWriter, nats NATSPublisher) *IngestServer {
	if cfg.Addr == "" {
		cfg.Addr = ":17543"
	}
	if ch == nil {
		ch = NewClickHouseWriter(cfg.ClickHouseURL)
	}
	if nats == nil {
		nats = NewSimpleNATSPublisher(cfg.NATSAddr)
	}

	s := &IngestServer{
		cfg:      cfg,
		chWriter: ch,
		natsPub:  nats,
	}

	// Initialize ring buffer with flush callback pointing to ClickHouse
	ringCb := func(flows []protocol.EBPFSocketFlow, metrics []protocol.TMMDPDKMetric, events []protocol.AIGatewayEvent) error {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()

		var firstErr error
		if len(flows) > 0 {
			if err := s.chWriter.BulkInsertFlows(ctx, flows); err != nil {
				log.Printf("[Ingest] ClickHouse flows flush error: %v", err)
				firstErr = err
			}
		}
		if len(metrics) > 0 {
			if err := s.chWriter.BulkInsertMetrics(ctx, metrics); err != nil {
				log.Printf("[Ingest] ClickHouse metrics flush error: %v", err)
				if firstErr == nil {
					firstErr = err
				}
			}
		}
		if len(events) > 0 {
			if err := s.chWriter.BulkInsertAIEvents(ctx, events); err != nil {
				log.Printf("[Ingest] ClickHouse AI events flush error: %v", err)
				if firstErr == nil {
					firstErr = err
				}
			}
		}
		return firstErr
	}

	s.ringBuffer = NewTelemetryRingBuffer(cfg.RingConfig, ringCb)
	return s
}

// Router sets up HTTP route handlers.
func (s *IngestServer) Router() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", s.handleHealthz)
	mux.HandleFunc("/metrics", s.handleMetrics)
	mux.HandleFunc("/api/v1/telemetry/batch", s.handleBatch)
	mux.HandleFunc("/api/v1/telemetry/register", s.handleRegister)
	mux.HandleFunc("/api/v1/telemetry/heartbeat", s.handleHeartbeat)

	if s.cfg.BackendURL != "" {
		if target, err := url.Parse(s.cfg.BackendURL); err == nil {
			proxy := httputil.NewSingleHostReverseProxy(target)
			if s.cfg.BackendTransport != nil {
				proxy.Transport = s.cfg.BackendTransport
			}
			mux.Handle("/api/fleet/enrollment/", proxy)
		}
	}

	return mux
}

// handleHealthz responds with service health.
func (s *IngestServer) handleHealthz(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"healthy","service":"forge-ingest"}`))
}

// handleMetrics returns current ingest statistics.
func (s *IngestServer) handleMetrics(w http.ResponseWriter, r *http.Request) {
	flows, metrics, events, errs := s.chWriter.Stats()
	resp := map[string]interface{}{
		"flows_inserted":   flows,
		"metrics_inserted": metrics,
		"events_inserted":  events,
		"errors_count":     errs,
		"timestamp":        time.Now().UTC().Format(time.RFC3339),
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resp)
}

// handleBatch processes incoming telemetry batches from agents.
func (s *IngestServer) handleBatch(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Validate SPIFFE ID if mTLS is required
	if s.cfg.RequireMTLS {
		spiffeID, ok := extractSPIFFEID(r.TLS)
		if !ok || !strings.HasPrefix(spiffeID, "spiffe://forge/cluster/") {
			http.Error(w, "Unauthorized: missing or invalid SPIFFE client identity", http.StatusUnauthorized)
			return
		}
	}

	body, err := io.ReadAll(io.LimitReader(r.Body, 10<<20)) // 10MB limit
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to read body: %v", err), http.StatusBadRequest)
		return
	}
	defer r.Body.Close()

	var batch protocol.TelemetryBatch
	if err := json.Unmarshal(body, &batch); err != nil {
		http.Error(w, fmt.Sprintf("Invalid JSON batch: %v", err), http.StatusBadRequest)
		return
	}

	// Enqueue into memory ring buffer
	s.ringBuffer.Enqueue(batch)

	// Detect drift or anomalies and notify NATS
	for _, f := range batch.Flows {
		if f.TmmBypassViolation {
			_ = s.natsPub.PublishClusterEvent(r.Context(), batch.ClusterID, ClusterEvent{
				ClusterID: batch.ClusterID,
				EventType: "drift_alert",
				Timestamp: time.Now().Unix(),
				Payload: map[string]interface{}{
					"message":   "TMM bypass violation detected",
					"pod_name":  f.PodName,
					"namespace": f.Namespace,
					"dst_port":  f.DstPort,
				},
			})
			break
		}
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"status":   "accepted",
		"batch_id": batch.BatchID,
		"received": len(batch.Flows) + len(batch.Metrics) + len(batch.AIEvents),
	})
}

// handleRegister processes agent registration handshakes.
func (s *IngestServer) handleRegister(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req protocol.RegisterRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, fmt.Sprintf("Invalid register request: %v", err), http.StatusBadRequest)
		return
	}

	agentID := fmt.Sprintf("agent-%s-%s", req.ClusterID, req.NodeName)
	resp := protocol.RegisterResponse{
		Status:               protocol.RegisterStatusOK,
		AgentID:              agentID,
		SessionToken:         fmt.Sprintf("session-%d", time.Now().UnixNano()),
		ServerTime:           time.Now().Unix(),
		HeartbeatIntervalSec: 15,
		AssignedConfig: map[string]string{
			"ebpf_enabled": "true",
			"tmm_enabled":  "true",
			"ring_flush_ms": "1000",
		},
		Message: "Registration accepted",
	}

	// Notify NATS of agent registration
	_ = s.natsPub.PublishClusterEvent(r.Context(), req.ClusterID, ClusterEvent{
		ClusterID: req.ClusterID,
		EventType: "agent_registered",
		Timestamp: time.Now().Unix(),
		Payload: map[string]interface{}{
			"agent_id":     agentID,
			"node_name":    req.NodeName,
			"cluster_name": req.ClusterName,
			"version":      req.AgentVersion,
		},
	})

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resp)
}

// handleHeartbeat handles agent health pings.
func (s *IngestServer) handleHeartbeat(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var ping protocol.Ping
	if err := json.NewDecoder(r.Body).Decode(&ping); err != nil {
		http.Error(w, fmt.Sprintf("Invalid ping: %v", err), http.StatusBadRequest)
		return
	}

	// Publish heartbeat to NATS
	_ = s.natsPub.PublishClusterEvent(r.Context(), ping.ClusterID, ClusterEvent{
		ClusterID: ping.ClusterID,
		EventType: "heartbeat",
		Timestamp: time.Now().Unix(),
		Payload: map[string]interface{}{
			"agent_id": ping.AgentID,
			"status":   ping.Status,
			"uptime":   ping.UptimeSeconds,
		},
	})

	// Forward heartbeat asynchronously to FastAPI backend to sync fleet state
	if s.cfg.BackendURL != "" {
		go s.notifyBackendHeartbeat(ping)
	}

	resp := protocol.Pong{
		ServerTimestamp:      time.Now().Unix(),
		Ack:                  true,
		PendingCommandsCount: 0,
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resp)
}

// notifyBackendHeartbeat dispatches agent heartbeat to FastAPI backend to update PostgreSQL fleet state.
func (s *IngestServer) notifyBackendHeartbeat(ping protocol.Ping) {
	endpoint := strings.TrimRight(s.cfg.BackendURL, "/") + "/api/fleet/enrollment/agent-heartbeat"
	payload := map[string]interface{}{
		"cluster_id":     ping.ClusterID,
		"agent_id":      ping.AgentID,
		"status":        ping.Status,
		"uptime_seconds": ping.UptimeSeconds,
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return
	}

	client := &http.Client{
		Timeout: 3 * time.Second,
	}
	if s.cfg.BackendTransport != nil {
		client.Transport = s.cfg.BackendTransport
	}

	req, err := http.NewRequest(http.MethodPost, endpoint, bytes.NewReader(data))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		log.Printf("[Ingest] Failed notifying backend of heartbeat: %v", err)
		return
	}
	defer resp.Body.Close()
}

// Start begins listening on the configured address.
func (s *IngestServer) Start() error {
	s.mu.Lock()
	s.active = true
	s.mu.Unlock()

	handler := s.Router()

	tlsConfig, err := s.buildTLSConfig()
	if err != nil {
		return fmt.Errorf("failed configuring TLS: %w", err)
	}

	s.httpServer = &http.Server{
		Addr:              s.cfg.Addr,
		Handler:           handler,
		TLSConfig:         tlsConfig,
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	ln, err := net.Listen("tcp", s.cfg.Addr)
	if err != nil {
		return fmt.Errorf("failed listening on %s: %w", s.cfg.Addr, err)
	}

	log.Printf("[Ingest] Ingest Gateway listening on %s (mTLS: %v)", s.cfg.Addr, s.cfg.RequireMTLS)

	if tlsConfig != nil {
		tlsListener := tls.NewListener(ln, tlsConfig)
		return s.httpServer.Serve(tlsListener)
	}
	return s.httpServer.Serve(ln)
}

// Shutdown gracefully shuts down the server and flushes the ring buffer.
func (s *IngestServer) Shutdown(ctx context.Context) error {
	s.mu.Lock()
	s.active = false
	s.mu.Unlock()

	var err error
	if s.httpServer != nil {
		err = s.httpServer.Shutdown(ctx)
	}
	if s.ringBuffer != nil {
		_ = s.ringBuffer.Close()
	}
	return err
}

func (s *IngestServer) buildTLSConfig() (*tls.Config, error) {
	if s.cfg.TLSCertFile == "" || s.cfg.TLSKeyFile == "" {
		return nil, nil // Non-TLS mode
	}

	if _, err := os.Stat(s.cfg.TLSCertFile); os.IsNotExist(err) {
		if !s.cfg.RequireMTLS {
			log.Printf("[Ingest] Notice: cert file %s not found and RequireMTLS=false; falling back to plaintext HTTP", s.cfg.TLSCertFile)
			return nil, nil
		}
		return nil, fmt.Errorf("unable to load server keypair: %w", err)
	}

	cert, err := tls.LoadX509KeyPair(s.cfg.TLSCertFile, s.cfg.TLSKeyFile)
	if err != nil {
		if !s.cfg.RequireMTLS {
			log.Printf("[Ingest] Warning: error loading server keypair (%v) and RequireMTLS=false; falling back to plaintext HTTP", err)
			return nil, nil
		}
		return nil, fmt.Errorf("unable to load server keypair: %w", err)
	}

	tlsConfig := &tls.Config{
		Certificates: []tls.Certificate{cert},
		MinVersion:   tls.VersionTLS13,
	}

	if s.cfg.RequireMTLS && s.cfg.ClientCAFile != "" {
		caBytes, err := os.ReadFile(s.cfg.ClientCAFile)
		if err != nil {
			return nil, fmt.Errorf("unable to read client CA: %w", err)
		}
		pool := x509.NewCertPool()
		if !pool.AppendCertsFromPEM(caBytes) {
			return nil, fmt.Errorf("failed parsing client CA certificates")
		}
		tlsConfig.ClientCAs = pool
		tlsConfig.ClientAuth = tls.RequireAndVerifyClientCert
	}

	return tlsConfig, nil
}

func extractSPIFFEID(state *tls.ConnectionState) (string, bool) {
	if state == nil || len(state.PeerCertificates) == 0 {
		return "", false
	}
	cert := state.PeerCertificates[0]
	for _, uri := range cert.URIs {
		if strings.HasPrefix(uri.String(), "spiffe://") {
			return uri.String(), true
		}
	}
	return "", false
}
