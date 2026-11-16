package transport

import (
	"context"
	"encoding/json"
	"fmt"
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

func TestFileDiskSpool(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "spool-test-*")
	if err != nil {
		t.Fatalf("failed creating temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	spool, err := NewFileDiskSpool(SpoolConfig{
		SpoolDir:     tempDir,
		MaxSizeBytes: 10 * 1024, // 10KB
	})
	if err != nil {
		t.Fatalf("NewFileDiskSpool failed: %v", err)
	}

	if spool.Len() != 0 {
		t.Fatalf("expected 0 batches, got %d", spool.Len())
	}

	// 1. Enqueue batches
	batch1 := &protocol.TelemetryBatch{
		BatchID:   "b-001",
		ClusterID: "c-123",
		NodeName:  "node-1",
		Flows: []protocol.EBPFSocketFlow{
			{SrcIP: "10.0.0.1", DstIP: "10.0.0.2", DstPort: 80},
		},
	}
	batch2 := &protocol.TelemetryBatch{
		BatchID:   "b-002",
		ClusterID: "c-123",
		NodeName:  "node-1",
		Flows: []protocol.EBPFSocketFlow{
			{SrcIP: "10.0.0.3", DstIP: "10.0.0.4", DstPort: 443},
		},
	}

	if err := spool.Enqueue(batch1); err != nil {
		t.Fatalf("Enqueue batch1 failed: %v", err)
	}
	if err := spool.Enqueue(batch2); err != nil {
		t.Fatalf("Enqueue batch2 failed: %v", err)
	}

	if spool.Len() != 2 {
		t.Fatalf("expected 2 batches, got %d", spool.Len())
	}

	// 2. Peek test
	peeked, err := spool.Peek()
	if err != nil || peeked == nil {
		t.Fatalf("Peek failed: %v", err)
	}
	if peeked.BatchID != "b-001" {
		t.Fatalf("expected peeked b-001, got %s", peeked.BatchID)
	}
	if spool.Len() != 2 {
		t.Fatalf("peek should not modify len, got %d", spool.Len())
	}

	// 3. Dequeue test
	deq1, err := spool.Dequeue()
	if err != nil || deq1 == nil {
		t.Fatalf("Dequeue 1 failed: %v", err)
	}
	if deq1.BatchID != "b-001" {
		t.Fatalf("expected b-001, got %s", deq1.BatchID)
	}
	if spool.Len() != 1 {
		t.Fatalf("expected len 1, got %d", spool.Len())
	}

	// 4. Recovery test: close and re-open
	_ = spool.Close()

	spool2, err := NewFileDiskSpool(SpoolConfig{
		SpoolDir:     tempDir,
		MaxSizeBytes: 10 * 1024,
	})
	if err != nil {
		t.Fatalf("Re-opening spool failed: %v", err)
	}
	defer spool2.Close()

	if spool2.Len() != 1 {
		t.Fatalf("expected recovered len 1, got %d", spool2.Len())
	}

	deq2, err := spool2.Dequeue()
	if err != nil || deq2 == nil {
		t.Fatalf("Dequeue 2 failed: %v", err)
	}
	if deq2.BatchID != "b-002" {
		t.Fatalf("expected b-002, got %s", deq2.BatchID)
	}
	if spool2.Len() != 0 {
		t.Fatalf("expected empty spool, got %d", spool2.Len())
	}
}

func TestFileDiskSpoolCapEviction(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "spool-cap-test-*")
	if err != nil {
		t.Fatalf("failed creating temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	// Cap at 1500 bytes (each batch will be ~250 bytes)
	spool, err := NewFileDiskSpool(SpoolConfig{
		SpoolDir:     tempDir,
		MaxSizeBytes: 1500,
	})
	if err != nil {
		t.Fatalf("NewFileDiskSpool failed: %v", err)
	}
	defer spool.Close()

	for i := 1; i <= 10; i++ {
		b := &protocol.TelemetryBatch{
			BatchID:   fmt.Sprintf("batch-%03d", i),
			ClusterID: "c-test",
			Flows: []protocol.EBPFSocketFlow{
				{SrcIP: "1.2.3.4", DstIP: "5.6.7.8", DstPort: 80},
			},
		}
		if err := spool.Enqueue(b); err != nil {
			t.Fatalf("Enqueue failed: %v", err)
		}
	}

	// Spool should have evicted earliest items to stay <= 1500 bytes
	if spool.ByteSize() > 1500 {
		t.Fatalf("expected ByteSize <= 1500, got %d", spool.ByteSize())
	}
	if spool.Len() >= 10 {
		t.Fatalf("expected oldest batches evicted, len is %d", spool.Len())
	}
	if spool.Len() == 0 {
		t.Fatalf("expected some batches to remain, got 0")
	}

	// Dequeued item must be one of the later batches (batch-001 should have been evicted)
	item, err := spool.Dequeue()
	if err != nil || item == nil {
		t.Fatalf("Dequeue failed: %v", err)
	}
	if item.BatchID == "batch-001" {
		t.Fatalf("batch-001 should have been evicted")
	}
}

func TestHTTPTransportAndSpooling(t *testing.T) {
	var receivedBatches int32
	var serverFail int32

	// Handler simulation
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		if atomic.LoadInt32(&serverFail) == 1 {
			http.Error(w, "down", http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	})
	mux.HandleFunc("/api/v1/telemetry/register", func(w http.ResponseWriter, r *http.Request) {
		resp := protocol.RegisterResponse{
			Status:               protocol.RegisterStatusOK,
			AgentID:              "agent-test-1",
			HeartbeatIntervalSec: 15,
		}
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(resp)
	})
	mux.HandleFunc("/api/v1/telemetry/heartbeat", func(w http.ResponseWriter, r *http.Request) {
		resp := protocol.Pong{
			ServerTimestamp: time.Now().Unix(),
			Ack:             true,
		}
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(resp)
	})
	mux.HandleFunc("/api/v1/telemetry/batch", func(w http.ResponseWriter, r *http.Request) {
		if atomic.LoadInt32(&serverFail) == 1 {
			http.Error(w, "server unavailable", http.StatusServiceUnavailable)
			return
		}
		var b protocol.TelemetryBatch
		_ = json.NewDecoder(r.Body).Decode(&b)
		atomic.AddInt32(&receivedBatches, 1)
		w.WriteHeader(http.StatusAccepted)
	})

	inMemoryTransport := roundTripperFunc(func(req *http.Request) (*http.Response, error) {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		resp := rec.Result()
		resp.Request = req
		return resp, nil
	})

	httpTr, err := NewHTTPTransport(HTTPTransportConfig{
		BaseURL:      "http://in-memory",
		RoundTripper: inMemoryTransport,
	})
	if err != nil {
		t.Fatalf("NewHTTPTransport failed: %v", err)
	}
	defer httpTr.Close()

	ctx := context.Background()

	// 1. Health & Register & Heartbeat
	if err := httpTr.Ping(ctx); err != nil {
		t.Fatalf("Ping failed: %v", err)
	}

	regResp, err := httpTr.Register(ctx, &protocol.RegisterRequest{
		ClusterID: "c-100",
		NodeName:  "worker-1",
	})
	if err != nil || regResp.AgentID != "agent-test-1" {
		t.Fatalf("Register failed: %v, resp: %+v", err, regResp)
	}

	pong, err := httpTr.SendHeartbeat(ctx, &protocol.Ping{
		ClusterID: "c-100",
		AgentID:   "agent-test-1",
	})
	if err != nil || !pong.Ack {
		t.Fatalf("Heartbeat failed: %v", err)
	}

	// 2. Setup SpoolingTransport
	spoolDir, err := os.MkdirTemp("", "spooling-transport-*")
	if err != nil {
		t.Fatalf("MkdirTemp failed: %v", err)
	}
	defer os.RemoveAll(spoolDir)

	spool, err := NewFileDiskSpool(SpoolConfig{SpoolDir: spoolDir})
	if err != nil {
		t.Fatalf("NewFileDiskSpool failed: %v", err)
	}

	st := NewSpoolingTransport(httpTr, spool)
	defer st.Close()

	// Direct stream succeeds
	batch1 := &protocol.TelemetryBatch{BatchID: "live-1"}
	if err := st.StreamBatch(ctx, batch1); err != nil {
		t.Fatalf("Direct StreamBatch failed: %v", err)
	}
	if atomic.LoadInt32(&receivedBatches) != 1 {
		t.Fatalf("expected 1 received batch, got %d", atomic.LoadInt32(&receivedBatches))
	}
	if st.SpoolLen() != 0 {
		t.Fatalf("expected 0 spooled, got %d", st.SpoolLen())
	}

	// 3. Simulate Server Outage (network partition)
	atomic.StoreInt32(&serverFail, 1)

	batch2 := &protocol.TelemetryBatch{BatchID: "offline-2"}
	batch3 := &protocol.TelemetryBatch{BatchID: "offline-3"}

	if err := st.StreamBatch(ctx, batch2); err != nil {
		t.Fatalf("StreamBatch during offline should buffer, got err: %v", err)
	}
	if err := st.StreamBatch(ctx, batch3); err != nil {
		t.Fatalf("StreamBatch during offline should buffer, got err: %v", err)
	}

	if st.SpoolLen() != 2 {
		t.Fatalf("expected 2 spooled batches during outage, got %d", st.SpoolLen())
	}

	// 4. Restore Server and verify automatic replay drain
	atomic.StoreInt32(&serverFail, 0)
	st.triggerDrain()

	// Wait up to 2 seconds for drain
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if st.SpoolLen() == 0 && atomic.LoadInt32(&receivedBatches) == 3 {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}

	if st.SpoolLen() != 0 {
		t.Fatalf("expected spool to be empty after drain, got %d", st.SpoolLen())
	}
	if atomic.LoadInt32(&receivedBatches) != 3 {
		t.Fatalf("expected 3 total received batches, got %d", atomic.LoadInt32(&receivedBatches))
	}
}
