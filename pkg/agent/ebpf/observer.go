package ebpf

import (
	"context"
	"sync"
	"time"

	"github.com/JLCode-tech/bnk-forge/pkg/protocol"
)

// Observer monitors socket lifecycle events and emits normalized EBPFSocketFlow records.
type Observer interface {
	Start(ctx context.Context) error
	Stop() error
	Flows() <-chan protocol.EBPFSocketFlow
}

// Config configures the eBPF socket observer.
type Config struct {
	ClusterID                 string
	NodeName                  string
	TmmGatewayIPs             []string
	ProtectedNamespaces       []string
	ProtectedPorts            []uint16
	BufferCapacity            int
	MockMode                  bool
	SyntheticEmissionInterval time.Duration
}

// SocketObserver is the standard implementation of Observer.
type SocketObserver struct {
	cfg       Config
	flowsChan chan protocol.EBPFSocketFlow
	detector  *DriftDetector
	stopChan  chan struct{}
	doneChan  chan struct{}
	mu        sync.Mutex
	running   bool
}

// NewSocketObserver constructs a new socket observer.
func NewSocketObserver(cfg Config) *SocketObserver {
	if cfg.BufferCapacity <= 0 {
		cfg.BufferCapacity = 10000
	}
	if cfg.NodeName == "" {
		cfg.NodeName = "node-01"
	}

	detector := NewDriftDetector(DriftConfig{
		TmmGatewayIPs:       cfg.TmmGatewayIPs,
		ProtectedNamespaces: cfg.ProtectedNamespaces,
		ProtectedPorts:      cfg.ProtectedPorts,
	})

	return &SocketObserver{
		cfg:       cfg,
		flowsChan: make(chan protocol.EBPFSocketFlow, cfg.BufferCapacity),
		detector:  detector,
		stopChan:  make(chan struct{}),
		doneChan:  make(chan struct{}),
	}
}

// Flows returns the receive-only channel of observed socket flows.
func (o *SocketObserver) Flows() <-chan protocol.EBPFSocketFlow {
	return o.flowsChan
}

// Start begins capturing socket tracepoints and producing flow events.
func (o *SocketObserver) Start(ctx context.Context) error {
	o.mu.Lock()
	if o.running {
		o.mu.Unlock()
		return nil
	}
	o.running = true
	o.mu.Unlock()

	go o.runLoop(ctx)
	return nil
}

// Stop cleanly terminates observation.
func (o *SocketObserver) Stop() error {
	o.mu.Lock()
	if !o.running {
		o.mu.Unlock()
		return nil
	}
	o.running = false
	o.mu.Unlock()

	close(o.stopChan)
	<-o.doneChan
	close(o.flowsChan)
	return nil
}

func (o *SocketObserver) emitFlow(flow protocol.EBPFSocketFlow) {
	// Enrich flow with cluster and node metadata
	if flow.ClusterID == "" {
		flow.ClusterID = o.cfg.ClusterID
	}
	if flow.NodeName == "" {
		flow.NodeName = o.cfg.NodeName
	}
	if flow.Timestamp == 0 {
		flow.Timestamp = time.Now().UnixMicro()
	}

	// Run TMM bypass and architecture drift detection
	flow.TmmBypassViolation = o.detector.CheckBypass(flow)

	select {
	case o.flowsChan <- flow:
	default:
		// Ring buffer full: drop or non-blocking skip to prevent stalling kernel collector
	}
}
