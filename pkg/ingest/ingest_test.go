package ingest

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/JLCode-tech/bnk-forge/pkg/protocol"
)

func TestRingBufferFlushOnBatchSize(t *testing.T) {
	var flushCalls int32
	var totalFlowsReceived int32

	cb := func(flows []protocol.EBPFSocketFlow, metrics []protocol.TMMDPDKMetric, events []protocol.AIGatewayEvent) error {
		atomic.AddInt32(&flushCalls, 1)
		atomic.AddInt32(&totalFlowsReceived, int32(len(flows)))
		return nil
	}

	cfg := RingBufferConfig{
		MaxBatchSize:  5,
		FlushInterval: 10 * time.Second, // Long interval so flush only triggers on capacity
	}
	rb := NewTelemetryRingBuffer(cfg, cb)
	defer rb.Close()

	// Enqueue 3 flows
	batch1 := protocol.TelemetryBatch{
		BatchID: "b1",
		Flows: []protocol.EBPFSocketFlow{
			{PodName: "p1"},
			{PodName: "p2"},
			{PodName: "p3"},
		},
	}
	rb.Enqueue(batch1)
	time.Sleep(50 * time.Millisecond)
	if atomic.LoadInt32(&flushCalls) != 0 {
		t.Errorf("Expected 0 flushes, got %d", atomic.LoadInt32(&flushCalls))
	}

	// Enqueue 2 more flows -> total 5, should trigger flush
	batch2 := protocol.TelemetryBatch{
		BatchID: "b2",
		Flows: []protocol.EBPFSocketFlow{
			{PodName: "p4"},
			{PodName: "p5"},
		},
	}
	rb.Enqueue(batch2)

	// Wait up to 500ms for flush
	start := time.Now()
	for time.Since(start) < 500*time.Millisecond {
		if atomic.LoadInt32(&flushCalls) > 0 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}

	if atomic.LoadInt32(&flushCalls) == 0 {
		t.Errorf("Expected flush on capacity, got 0")
	}
	if atomic.LoadInt32(&totalFlowsReceived) != 5 {
		t.Errorf("Expected 5 flows received, got %d", atomic.LoadInt32(&totalFlowsReceived))
	}
}

func TestRingBufferFlushOnTimer(t *testing.T) {
	var flushCalls int32
	var totalMetricsReceived int32

	cb := func(flows []protocol.EBPFSocketFlow, metrics []protocol.TMMDPDKMetric, events []protocol.AIGatewayEvent) error {
		atomic.AddInt32(&flushCalls, 1)
		atomic.AddInt32(&totalMetricsReceived, int32(len(metrics)))
		return nil
	}

	cfg := RingBufferConfig{
		MaxBatchSize:  1000,
		FlushInterval: 50 * time.Millisecond,
	}
	rb := NewTelemetryRingBuffer(cfg, cb)
	defer rb.Close()

	rb.Enqueue(protocol.TelemetryBatch{
		BatchID: "b-timer",
		Metrics: []protocol.TMMDPDKMetric{
			{TmmPod: "tmm-1"},
		},
	})

	time.Sleep(150 * time.Millisecond)

	if atomic.LoadInt32(&flushCalls) == 0 {
		t.Errorf("Expected timer flush, got 0 calls")
	}
	if atomic.LoadInt32(&totalMetricsReceived) != 1 {
		t.Errorf("Expected 1 metric flushed, got %d", atomic.LoadInt32(&totalMetricsReceived))
	}
}

func TestIngestServerEndpoints(t *testing.T) {
	mockNATS := NewInMemoryNATSPublisher()
	server := NewIngestServer(ServerConfig{Addr: ":0"}, nil, mockNATS)
	defer server.ringBuffer.Close()

	handler := server.Router()

	// 1. Test /healthz
	reqH := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	rrH := httptest.NewRecorder()
	handler.ServeHTTP(rrH, reqH)
	if rrH.Code != http.StatusOK {
		t.Errorf("Expected 200 from /healthz, got %d", rrH.Code)
	}

	// 2. Test /api/v1/telemetry/register
	regReq := protocol.RegisterRequest{
		ClusterID:          "cls-test-1",
		ClusterName:        "Test Cluster",
		AgentVersion:       "1.0.0",
		Hostname:           "worker-01",
		NodeName:           "node-01",
		Capabilities:       []string{"ebpf", "tmm"},
		MachineFingerprint: "fp-xyz-123",
	}
	regBytes, _ := json.Marshal(regReq)
	reqR := httptest.NewRequest(http.MethodPost, "/api/v1/telemetry/register", bytes.NewReader(regBytes))
	rrR := httptest.NewRecorder()
	handler.ServeHTTP(rrR, reqR)
	if rrR.Code != http.StatusOK {
		t.Errorf("Expected 200 from /register, got %d: %s", rrR.Code, rrR.Body.String())
	}
	var regResp protocol.RegisterResponse
	_ = json.Unmarshal(rrR.Body.Bytes(), &regResp)
	if regResp.Status != protocol.RegisterStatusOK {
		t.Errorf("Expected Status OK, got %v", regResp.Status)
	}

	// 3. Test /api/v1/telemetry/heartbeat
	ping := protocol.Ping{
		ClusterID:     "cls-test-1",
		AgentID:       regResp.AgentID,
		Timestamp:     time.Now().Unix(),
		Status:        "RUNNING",
		UptimeSeconds: 120,
	}
	pingBytes, _ := json.Marshal(ping)
	reqP := httptest.NewRequest(http.MethodPost, "/api/v1/telemetry/heartbeat", bytes.NewReader(pingBytes))
	rrP := httptest.NewRecorder()
	handler.ServeHTTP(rrP, reqP)
	if rrP.Code != http.StatusOK {
		t.Errorf("Expected 200 from /heartbeat, got %d", rrP.Code)
	}
	var pong protocol.Pong
	_ = json.Unmarshal(rrP.Body.Bytes(), &pong)
	if !pong.Ack {
		t.Errorf("Expected Pong Ack true")
	}

	// 4. Test /api/v1/telemetry/batch
	batch := protocol.TelemetryBatch{
		BatchID:   "b-test-99",
		ClusterID: "cls-test-1",
		NodeName:  "node-01",
		SentAt:    time.Now().UnixNano(),
		Flows: []protocol.EBPFSocketFlow{
			{
				PodName:            "pod-a",
				Namespace:          "default",
				TmmBypassViolation: true, // Should trigger drift_alert to NATS
			},
		},
	}
	batchBytes, _ := json.Marshal(batch)
	reqB := httptest.NewRequest(http.MethodPost, "/api/v1/telemetry/batch", bytes.NewReader(batchBytes))
	rrB := httptest.NewRecorder()
	handler.ServeHTTP(rrB, reqB)
	if rrB.Code != http.StatusAccepted {
		t.Errorf("Expected 202 Accepted from /batch, got %d", rrB.Code)
	}

	// Verify NATS events were published
	if len(mockNATS.Events) < 3 {
		t.Errorf("Expected at least 3 NATS events (registered, heartbeat, drift_alert), got %d", len(mockNATS.Events))
	}

	// 5. Test /metrics
	reqM := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	rrM := httptest.NewRecorder()
	handler.ServeHTTP(rrM, reqM)
	if rrM.Code != http.StatusOK {
		t.Errorf("Expected 200 from /metrics, got %d", rrM.Code)
	}

	// 6. Test Reverse Proxy to FastAPI Backend for Enrollment
	rt := roundTripFunc(func(req *http.Request) *http.Response {
		if req.URL.Path == "/api/fleet/enrollment/ca" {
			return &http.Response{
				StatusCode: http.StatusOK,
				Header:     make(http.Header),
				Body:       io.NopCloser(bytes.NewBufferString(`{"ca_bundle_pem":"MOCK"}`)),
			}
		}
		return &http.Response{
			StatusCode: http.StatusNotFound,
			Header:     make(http.Header),
			Body:       io.NopCloser(bytes.NewBufferString("not found")),
		}
	})

	serverWithBackend := NewIngestServer(ServerConfig{
		Addr:             ":0",
		BackendURL:       "http://backend.internal",
		BackendTransport: rt,
	}, nil, mockNATS)
	defer serverWithBackend.ringBuffer.Close()

	handlerWithBackend := serverWithBackend.Router()
	reqProxy := httptest.NewRequest(http.MethodGet, "/api/fleet/enrollment/ca", nil)
	rrProxy := httptest.NewRecorder()
	handlerWithBackend.ServeHTTP(rrProxy, reqProxy)
	if rrProxy.Code != http.StatusOK {
		t.Errorf("Expected 200 from reverse-proxied /api/fleet/enrollment/ca, got %d", rrProxy.Code)
	}
}

type roundTripFunc func(req *http.Request) *http.Response

func (f roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req), nil
}
