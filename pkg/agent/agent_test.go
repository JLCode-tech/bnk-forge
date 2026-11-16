package agent

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"sync/atomic"
	"testing"
	"time"

	"github.com/JLCode-tech/bnk-forge/pkg/protocol"
)

type roundTripperFunc func(*http.Request) (*http.Response, error)

func (f roundTripperFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

func TestAgentEndToEndRunloop(t *testing.T) {
	var registered int32
	var heartbeats int32
	var batchesReceived int32
	var flowsCount int32
	var metricsCount int32

	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	})
	mux.HandleFunc("/api/v1/telemetry/register", func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&registered, 1)
		var req protocol.RegisterRequest
		_ = json.NewDecoder(r.Body).Decode(&req)
		resp := protocol.RegisterResponse{
			Status:               protocol.RegisterStatusOK,
			AgentID:              "agent-test-cluster-node-01",
			HeartbeatIntervalSec: 0,
		}
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(resp)
	})
	mux.HandleFunc("/api/v1/telemetry/heartbeat", func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&heartbeats, 1)
		resp := protocol.Pong{
			ServerTimestamp: time.Now().Unix(),
			Ack:             true,
		}
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(resp)
	})
	mux.HandleFunc("/api/v1/telemetry/batch", func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&batchesReceived, 1)
		var batch protocol.TelemetryBatch
		_ = json.NewDecoder(r.Body).Decode(&batch)
		atomic.AddInt32(&flowsCount, int32(len(batch.Flows)))
		atomic.AddInt32(&metricsCount, int32(len(batch.Metrics)))
		w.WriteHeader(http.StatusAccepted)
	})

	rt := roundTripperFunc(func(req *http.Request) (*http.Response, error) {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		resp := rec.Result()
		resp.Request = req
		return resp, nil
	})

	tempSpoolDir, err := os.MkdirTemp("", "agent-test-spool-*")
	if err != nil {
		t.Fatalf("MkdirTemp failed: %v", err)
	}
	defer os.RemoveAll(tempSpoolDir)

	agent := NewAgent(Config{
		ConsoleURL:        "http://in-memory",
		ClusterID:         "test-cluster-uuid",
		ClusterName:       "E2E Test Cluster",
		NodeName:          "node-01",
		SpoolDir:          tempSpoolDir,
		HeartbeatInterval: 100 * time.Millisecond,
		FlushInterval:     50 * time.Millisecond,
		BatchSize:         10,
		MockMode:          true,
		RoundTripper:      rt,
	})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	if err := agent.Start(ctx); err != nil {
		t.Fatalf("agent.Start failed: %v", err)
	}

	// Wait up to 500ms for registration, heartbeats, and telemetry batches to flow
	deadline := time.Now().Add(600 * time.Millisecond)
	for time.Now().Before(deadline) {
		if atomic.LoadInt32(&batchesReceived) >= 2 && atomic.LoadInt32(&heartbeats) >= 2 {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}

	// Stop agent cleanly
	if err := agent.Stop(); err != nil {
		t.Fatalf("agent.Stop failed: %v", err)
	}

	if atomic.LoadInt32(&registered) != 1 {
		t.Errorf("expected 1 registration, got %d", atomic.LoadInt32(&registered))
	}
	if atomic.LoadInt32(&heartbeats) < 2 {
		t.Errorf("expected at least 2 heartbeats, got %d", atomic.LoadInt32(&heartbeats))
	}
	if atomic.LoadInt32(&batchesReceived) < 2 {
		t.Errorf("expected at least 2 batches received, got %d", atomic.LoadInt32(&batchesReceived))
	}
	if atomic.LoadInt32(&flowsCount) == 0 {
		t.Errorf("expected flows to be collected and streamed, got 0")
	}
	if atomic.LoadInt32(&metricsCount) == 0 {
		t.Errorf("expected DPDK metrics to be collected and streamed, got 0")
	}
}
