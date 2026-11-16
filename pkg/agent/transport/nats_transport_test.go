package transport

import (
	"bytes"
	"context"
	"errors"
	"net"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/JLCode-tech/bnk-forge/pkg/protocol"
)

// MockWireConn implements a buffer-backed net.Conn for unit testing wire protocols.
type MockWireConn struct {
	mu       sync.Mutex
	written  bytes.Buffer
	readBuf  bytes.Buffer
	isClosed bool
}

func (m *MockWireConn) Read(b []byte) (n int, err error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.readBuf.Read(b)
}

func (m *MockWireConn) Write(b []byte) (n int, err error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.isClosed {
		return 0, errors.New("connection closed")
	}
	return m.written.Write(b)
}

func (m *MockWireConn) Close() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.isClosed = true
	return nil
}

func (m *MockWireConn) LocalAddr() net.Addr                { return &net.TCPAddr{Port: 12345} }
func (m *MockWireConn) RemoteAddr() net.Addr               { return &net.TCPAddr{Port: 4222} }
func (m *MockWireConn) SetDeadline(t time.Time) error      { return nil }
func (m *MockWireConn) SetReadDeadline(t time.Time) error  { return nil }
func (m *MockWireConn) SetWriteDeadline(t time.Time) error { return nil }

func (m *MockWireConn) GetWritten() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.written.String()
}

// MockTransport provides an in-memory transport implementation for testing DualTransport.
type MockTransport struct {
	mu           sync.Mutex
	Batches      []*protocol.TelemetryBatch
	Heartbeats   []*protocol.Ping
	Registers    []*protocol.RegisterRequest
	FailStream   bool
	FailRegister bool
	FailPing     bool
	Closed       bool
}

func (m *MockTransport) StreamBatch(ctx context.Context, batch *protocol.TelemetryBatch) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.FailStream {
		return errors.New("mock transport stream error")
	}
	m.Batches = append(m.Batches, batch)
	return nil
}

func (m *MockTransport) Register(ctx context.Context, req *protocol.RegisterRequest) (*protocol.RegisterResponse, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.FailRegister {
		return nil, errors.New("mock transport register error")
	}
	m.Registers = append(m.Registers, req)
	return &protocol.RegisterResponse{
		Status:               protocol.RegisterStatusOK,
		AgentID:              "mock-agent-" + req.ClusterID,
		HeartbeatIntervalSec: 15,
		SessionToken:         "mock-token-123",
	}, nil
}

func (m *MockTransport) SendHeartbeat(ctx context.Context, ping *protocol.Ping) (*protocol.Pong, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.Heartbeats = append(m.Heartbeats, ping)
	return &protocol.Pong{
		ServerTimestamp: time.Now().Unix(),
		Ack:             true,
	}, nil
}

func (m *MockTransport) Ping(ctx context.Context) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.FailPing {
		return errors.New("mock transport ping unreachable")
	}
	return nil
}

func (m *MockTransport) Close() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.Closed = true
	return nil
}

func TestNATSTransportStreamBatch(t *testing.T) {
	mockConn := &MockWireConn{}

	tr, err := NewNATSTransport(NATSTransportConfig{
		NATSURL:       "localhost:4222",
		ClusterID:     "cluster-alpha",
		NodeName:      "node-01",
		SubjectPrefix: "forge.telemetry",
		Dialer: func(network, address string) (net.Conn, error) {
			return mockConn, nil
		},
	})
	if err != nil {
		t.Fatalf("failed creating NATSTransport: %v", err)
	}

	batch := &protocol.TelemetryBatch{
		BatchID:   "batch-001",
		ClusterID: "cluster-alpha",
		NodeName:  "node-01",
		SentAt:    time.Now().UnixNano(),
		Flows: []protocol.EBPFSocketFlow{
			{SrcIP: "10.244.1.5", DstIP: "10.244.2.10", DstPort: 8080, Direction: protocol.FlowDirectionInbound},
		},
	}

	ctx := context.Background()
	if err := tr.StreamBatch(ctx, batch); err != nil {
		t.Fatalf("StreamBatch failed: %v", err)
	}

	output := mockConn.GetWritten()
	if !strings.Contains(output, "CONNECT {") {
		t.Errorf("expected NATS CONNECT handshake in output, got: %s", output)
	}
	if !strings.Contains(output, "PUB forge.telemetry.cluster-alpha.batches") {
		t.Errorf("expected PUB to forge.telemetry.cluster-alpha.batches, got: %s", output)
	}
	if !strings.Contains(output, "batch-001") {
		t.Errorf("expected batch ID in payload, got: %s", output)
	}
}

func TestNATSTransportRegisterAndHeartbeat(t *testing.T) {
	mockConn := &MockWireConn{}

	tr, err := NewNATSTransport(NATSTransportConfig{
		NATSURL:       "nats://core-nats:4222",
		ClusterID:     "cluster-beta",
		NodeName:      "node-02",
		SubjectPrefix: "forge.telemetry",
		Dialer: func(network, address string) (net.Conn, error) {
			return mockConn, nil
		},
	})
	if err != nil {
		t.Fatalf("NewNATSTransport error: %v", err)
	}

	ctx := context.Background()

	// Register
	regReq := &protocol.RegisterRequest{
		ClusterID:    "cluster-beta",
		ClusterName:  "Beta Cluster",
		AgentVersion: "1.0.0-pov",
		NodeName:     "node-02",
	}
	regResp, err := tr.Register(ctx, regReq)
	if err != nil {
		t.Fatalf("Register failed: %v", err)
	}
	if regResp.AgentID != "agent-cluster-beta-node-02" {
		t.Errorf("unexpected agent ID: %s", regResp.AgentID)
	}

	// Heartbeat
	hbReq := &protocol.Ping{
		ClusterID:     "cluster-beta",
		AgentID:       regResp.AgentID,
		Timestamp:     time.Now().Unix(),
		Status:        "HEALTHY",
		UptimeSeconds: 120,
	}
	pong, err := tr.SendHeartbeat(ctx, hbReq)
	if err != nil {
		t.Fatalf("SendHeartbeat failed: %v", err)
	}
	if !pong.Ack {
		t.Errorf("expected heartbeat to be acknowledged")
	}

	output := mockConn.GetWritten()
	if !strings.Contains(output, "PUB forge.telemetry.cluster-beta.register") {
		t.Errorf("missing register PUB command: %s", output)
	}
	if !strings.Contains(output, "PUB forge.telemetry.cluster-beta.heartbeat") {
		t.Errorf("missing heartbeat PUB command: %s", output)
	}
}

func TestNATSTransportPingAndClose(t *testing.T) {
	mockConn := &MockWireConn{}

	tr, err := NewNATSTransport(NATSTransportConfig{
		NATSURL:   "localhost:4222",
		ClusterID: "c1",
		Dialer: func(network, address string) (net.Conn, error) {
			return mockConn, nil
		},
	})
	if err != nil {
		t.Fatalf("NewNATSTransport failed: %v", err)
	}

	ctx := context.Background()
	if err := tr.Ping(ctx); err != nil {
		t.Fatalf("Ping failed: %v", err)
	}

	if !strings.Contains(mockConn.GetWritten(), "PING\r\n") {
		t.Errorf("expected wire PING in output")
	}

	if err := tr.Close(); err != nil {
		t.Fatalf("Close failed: %v", err)
	}

	if !mockConn.isClosed {
		t.Errorf("expected underlying net.Conn to be closed")
	}
}

func TestDualTransportFailover(t *testing.T) {
	primaryMock := &MockTransport{FailStream: true}
	secondaryMock := &MockTransport{}

	dual := NewDualTransport(DualTransportConfig{
		Primary:   primaryMock,
		Secondary: secondaryMock,
		Mode:      ModeFailover,
	})

	batch := &protocol.TelemetryBatch{
		BatchID:   "failover-batch-1",
		ClusterID: "cluster-pov",
	}

	ctx := context.Background()
	err := dual.StreamBatch(ctx, batch)
	if err != nil {
		t.Fatalf("expected successful failover to secondary, got err: %v", err)
	}

	// Verify secondary received batch
	if len(secondaryMock.Batches) != 1 {
		t.Fatalf("expected 1 batch in secondary transport, got %d", len(secondaryMock.Batches))
	}
	if secondaryMock.Batches[0].BatchID != "failover-batch-1" {
		t.Errorf("batch mismatch: %s", secondaryMock.Batches[0].BatchID)
	}
}

func TestDualTransportMirror(t *testing.T) {
	primaryMock := &MockTransport{}
	secondaryMock := &MockTransport{}

	dual := NewDualTransport(DualTransportConfig{
		Primary:   primaryMock,
		Secondary: secondaryMock,
		Mode:      ModeMirror,
	})

	batch := &protocol.TelemetryBatch{
		BatchID:   "mirror-batch-1",
		ClusterID: "cluster-pov",
	}

	ctx := context.Background()
	if err := dual.StreamBatch(ctx, batch); err != nil {
		t.Fatalf("StreamBatch mirror failed: %v", err)
	}

	// Both should have received the batch
	if len(primaryMock.Batches) != 1 || len(secondaryMock.Batches) != 1 {
		t.Fatalf("expected batch in both transports: primary=%d, secondary=%d",
			len(primaryMock.Batches), len(secondaryMock.Batches))
	}
}

func TestDualTransportModes(t *testing.T) {
	primaryMock := &MockTransport{}
	secondaryMock := &MockTransport{}

	// Test ModeNATS
	dualNats := NewDualTransport(DualTransportConfig{
		Primary:   primaryMock,
		Secondary: secondaryMock,
		Mode:      ModeNATS,
	})

	batch := &protocol.TelemetryBatch{BatchID: "nats-only-1"}
	if err := dualNats.StreamBatch(context.Background(), batch); err != nil {
		t.Fatalf("ModeNATS error: %v", err)
	}

	if len(primaryMock.Batches) != 0 {
		t.Errorf("expected 0 batches on primary in ModeNATS, got %d", len(primaryMock.Batches))
	}
	if len(secondaryMock.Batches) != 1 {
		t.Errorf("expected 1 batch on secondary in ModeNATS, got %d", len(secondaryMock.Batches))
	}

	// Test Ping and Close
	if err := dualNats.Ping(context.Background()); err != nil {
		t.Errorf("Ping failed: %v", err)
	}
	if err := dualNats.Close(); err != nil {
		t.Errorf("Close failed: %v", err)
	}
	if !primaryMock.Closed || !secondaryMock.Closed {
		t.Errorf("expected both transports to be closed")
	}
}
