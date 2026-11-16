package ingest

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"sync"
	"time"
)

// ClusterEvent represents a cluster state change or drift notification published to NATS.
type ClusterEvent struct {
	ClusterID string                 `json:"cluster_id"`
	EventType string                 `json:"event_type"` // e.g. "agent_registered", "heartbeat", "drift_alert", "flow_spike"
	Timestamp int64                  `json:"timestamp"`
	Payload   map[string]interface{} `json:"payload"`
}

// NATSPublisher publishes cluster state events to NATS subjects.
type NATSPublisher interface {
	PublishClusterEvent(ctx context.Context, clusterID string, event ClusterEvent) error
	Close() error
}

// SimpleNATSPublisher provides a TCP-based NATS publisher with zero external heavy dependencies.
type SimpleNATSPublisher struct {
	natsAddr string
	conn     net.Conn
	mu       sync.Mutex
}

// NewSimpleNATSPublisher creates a publisher targeting a NATS daemon (e.g. "localhost:4222").
func NewSimpleNATSPublisher(natsAddr string) *SimpleNATSPublisher {
	if natsAddr == "" {
		natsAddr = "localhost:4222"
	}
	p := &SimpleNATSPublisher{natsAddr: natsAddr}
	_ = p.connect()
	return p
}

func (p *SimpleNATSPublisher) connect() error {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.conn != nil {
		_ = p.conn.Close()
	}

	conn, err := net.DialTimeout("tcp", p.natsAddr, 2*time.Second)
	if err != nil {
		return err
	}
	p.conn = conn

	// Send initial CONNECT info
	connectMsg := []byte("CONNECT {\"verbose\":false,\"pedantic\":false,\"lang\":\"go\",\"version\":\"1.0.0\"}\r\n")
	_, err = p.conn.Write(connectMsg)
	return err
}

// PublishClusterEvent sends the event payload to subject `forge.cluster.{cluster_id}.events`.
func (p *SimpleNATSPublisher) PublishClusterEvent(ctx context.Context, clusterID string, event ClusterEvent) error {
	subject := fmt.Sprintf("forge.cluster.%s.events", clusterID)
	data, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("failed to marshal cluster event: %w", err)
	}

	p.mu.Lock()
	defer p.mu.Unlock()

	if p.conn == nil {
		// Attempt reconnect
		conn, err := net.DialTimeout("tcp", p.natsAddr, 2*time.Second)
		if err != nil {
			return fmt.Errorf("nats connection offline (%s): %w", p.natsAddr, err)
		}
		p.conn = conn
	}

	// Protocol line: PUB <subject> <bytes>\r\n<payload>\r\n
	pubHeader := fmt.Sprintf("PUB %s %d\r\n", subject, len(data))
	if _, err := p.conn.Write([]byte(pubHeader)); err != nil {
		_ = p.conn.Close()
		p.conn = nil
		return fmt.Errorf("nats write header failed: %w", err)
	}
	if _, err := p.conn.Write(append(data, []byte("\r\n")...)); err != nil {
		_ = p.conn.Close()
		p.conn = nil
		return fmt.Errorf("nats write payload failed: %w", err)
	}

	return nil
}

// Close closes the NATS connection.
func (p *SimpleNATSPublisher) Close() error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.conn != nil {
		err := p.conn.Close()
		p.conn = nil
		return err
	}
	return nil
}

// InMemoryNATSPublisher is a mock publisher for testing and isolated dev environments.
type InMemoryNATSPublisher struct {
	mu     sync.Mutex
	Events []ClusterEvent
}

func NewInMemoryNATSPublisher() *InMemoryNATSPublisher {
	return &InMemoryNATSPublisher{
		Events: make([]ClusterEvent, 0),
	}
}

func (m *InMemoryNATSPublisher) PublishClusterEvent(ctx context.Context, clusterID string, event ClusterEvent) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.Events = append(m.Events, event)
	log.Printf("[NATS-Mock] Published to forge.cluster.%s.events: %s", clusterID, event.EventType)
	return nil
}

func (m *InMemoryNATSPublisher) Close() error {
	return nil
}
