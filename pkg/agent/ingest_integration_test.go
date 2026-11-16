package agent

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/JLCode-tech/bnk-forge/pkg/ingest"
)

type mockNATSPublisher struct {
	mu     sync.Mutex
	events []ingest.ClusterEvent
}

func (m *mockNATSPublisher) PublishClusterEvent(ctx context.Context, clusterID string, event ingest.ClusterEvent) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.events = append(m.events, event)
	return nil
}

func (m *mockNATSPublisher) Close() error {
	return nil
}

func (m *mockNATSPublisher) getEvents() []ingest.ClusterEvent {
	m.mu.Lock()
	defer m.mu.Unlock()
	copied := make([]ingest.ClusterEvent, len(m.events))
	copy(copied, m.events)
	return copied
}

func TestAgentToIngestGatewayIntegration(t *testing.T) {
	mockNATS := &mockNATSPublisher{}

	// Setup ClickHouse writer targeting local test URL (with in-memory fallback)
	chWriter := ingest.NewClickHouseWriter("http://localhost:8123")

	ingestCfg := ingest.ServerConfig{
		Addr:        ":17543",
		RequireMTLS: false,
		RingConfig: ingest.RingBufferConfig{
			MaxBatchSize:  5,
			FlushInterval: 50 * time.Millisecond,
		},
	}

	ingestServer := ingest.NewIngestServer(ingestCfg, chWriter, mockNATS)
	ingestHandler := ingestServer.Router()

	// In-memory HTTP RoundTripper directing traffic straight to IngestServer.Router()
	agentTransport := roundTripperFunc(func(req *http.Request) (*http.Response, error) {
		rec := httptest.NewRecorder()
		ingestHandler.ServeHTTP(rec, req)
		resp := rec.Result()
		resp.Request = req
		return resp, nil
	})

	tempSpoolDir, err := os.MkdirTemp("", "agent-ingest-spool-*")
	if err != nil {
		t.Fatalf("MkdirTemp failed: %v", err)
	}
	defer os.RemoveAll(tempSpoolDir)

	agentInstance := NewAgent(Config{
		ConsoleURL:          "http://forge-ingest:17543",
		ClusterID:           "cluster-prod-101",
		ClusterName:         "Production US-East",
		NodeName:            "worker-gpu-0",
		SpoolDir:            tempSpoolDir,
		HeartbeatInterval:   100 * time.Millisecond,
		FlushInterval:       50 * time.Millisecond,
		BatchSize:           10,
		MockMode:            true,
		RoundTripper:        agentTransport,
		TmmGatewayIPs:       []string{"10.244.0.50"},
		ProtectedNamespaces: []string{"ai-inference"},
		ProtectedPorts:            []uint16{8000},
		SyntheticEmissionInterval: 30 * time.Millisecond,
	})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	if err := agentInstance.Start(ctx); err != nil {
		t.Fatalf("agentInstance.Start failed: %v", err)
	}

	// Allow agent to run for 500ms to register, heartbeat, stream batches, and trigger bypass alerts
	time.Sleep(500 * time.Millisecond)

	if err := agentInstance.Stop(); err != nil {
		t.Fatalf("agentInstance.Stop failed: %v", err)
	}

	// Verify NATS events emitted by Ingest Gateway
	events := mockNATS.getEvents()
	if len(events) < 2 {
		t.Fatalf("expected at least 2 NATS events from ingest gateway, got %d", len(events))
	}

	var hasRegistered, hasHeartbeat, hasDriftAlert bool
	for _, ev := range events {
		if ev.ClusterID != "cluster-prod-101" {
			t.Errorf("expected event ClusterID cluster-prod-101, got %s", ev.ClusterID)
		}
		switch ev.EventType {
		case "agent_registered":
			hasRegistered = true
		case "heartbeat":
			hasHeartbeat = true
		case "drift_alert":
			hasDriftAlert = true
		}
	}

	if !hasRegistered {
		t.Errorf("Ingest Gateway never published agent_registered event to NATS")
	}
	if !hasHeartbeat {
		t.Errorf("Ingest Gateway never published heartbeat event to NATS")
	}
	if !hasDriftAlert {
		t.Errorf("Ingest Gateway never published drift_alert for TMM bypass flow to NATS")
	}
}
