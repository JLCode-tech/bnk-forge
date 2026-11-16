package tmm

import (
	"context"
	"net"
	"sync"
	"time"

	"github.com/JLCode-tech/bnk-forge/pkg/protocol"
)

// Harvester extracts DPDK microkernel and ring telemetry from F5 BNK TMM.
type Harvester interface {
	Start(ctx context.Context) error
	Stop() error
	Metrics() <-chan protocol.TMMDPDKMetric
}

// Config configures the TMM DPDK harvester.
type Config struct {
	ClusterID      string
	NodeName       string
	TmmPod         string
	SocketPath     string
	PollInterval   time.Duration
	BufferCapacity int
	MockMode       bool
	Dialer         func(ctx context.Context) (net.Conn, error)
}

// DPDKHarvester implements Harvester.
type DPDKHarvester struct {
	cfg         Config
	metricsChan chan protocol.TMMDPDKMetric
	stopChan    chan struct{}
	doneChan    chan struct{}
	mu          sync.Mutex
	running     bool
}

// NewDPDKHarvester constructs a new harvester.
func NewDPDKHarvester(cfg Config) *DPDKHarvester {
	if cfg.SocketPath == "" {
		cfg.SocketPath = "/var/run/tmm/tmctl.sock"
	}
	if cfg.TmmPod == "" {
		cfg.TmmPod = "f5-tmm-0"
	}
	if cfg.NodeName == "" {
		cfg.NodeName = "node-01"
	}
	if cfg.PollInterval <= 0 {
		cfg.PollInterval = 5 * time.Second
	}
	if cfg.BufferCapacity <= 0 {
		cfg.BufferCapacity = 1000
	}

	return &DPDKHarvester{
		cfg:         cfg,
		metricsChan: make(chan protocol.TMMDPDKMetric, cfg.BufferCapacity),
		stopChan:    make(chan struct{}),
		doneChan:    make(chan struct{}),
	}
}

// Metrics returns the receive-only channel of scraped DPDK metrics.
func (h *DPDKHarvester) Metrics() <-chan protocol.TMMDPDKMetric {
	return h.metricsChan
}

// Start begins periodic polling of TMM.
func (h *DPDKHarvester) Start(ctx context.Context) error {
	h.mu.Lock()
	if h.running {
		h.mu.Unlock()
		return nil
	}
	h.running = true
	h.mu.Unlock()

	go h.runLoop(ctx)
	return nil
}

// Stop cleanly terminates harvesting.
func (h *DPDKHarvester) Stop() error {
	h.mu.Lock()
	if !h.running {
		h.mu.Unlock()
		return nil
	}
	h.running = false
	h.mu.Unlock()

	close(h.stopChan)
	<-h.doneChan
	close(h.metricsChan)
	return nil
}

func (h *DPDKHarvester) emitMetric(m protocol.TMMDPDKMetric) {
	if m.ClusterID == "" {
		m.ClusterID = h.cfg.ClusterID
	}
	if m.NodeName == "" {
		m.NodeName = h.cfg.NodeName
	}
	if m.TmmPod == "" {
		m.TmmPod = h.cfg.TmmPod
	}
	if m.Timestamp == 0 {
		m.Timestamp = time.Now().UnixMicro()
	}

	select {
	case h.metricsChan <- m:
	default:
		// Drop on saturated channel to prevent blocking reader
	}
}
