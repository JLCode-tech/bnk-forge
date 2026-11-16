package ingest

import (
	"context"
	"sync"
	"time"

	"github.com/JLCode-tech/bnk-forge/pkg/protocol"
)

// FlushCallback is invoked when the ring buffer reaches its threshold or timer.
type FlushCallback func(flows []protocol.EBPFSocketFlow, metrics []protocol.TMMDPDKMetric, events []protocol.AIGatewayEvent) error

// RingBufferConfig configures buffer thresholds and timeouts.
type RingBufferConfig struct {
	MaxBatchSize  int
	FlushInterval time.Duration
}

// DefaultRingBufferConfig returns standard PoV defaults (5,000 records or 1,000ms flush).
func DefaultRingBufferConfig() RingBufferConfig {
	return RingBufferConfig{
		MaxBatchSize:  5000,
		FlushInterval: 1000 * time.Millisecond,
	}
}

// TelemetryRingBuffer manages zero-allocation batch buffering and periodic flushes.
type TelemetryRingBuffer struct {
	cfg       RingBufferConfig
	callback  FlushCallback
	mu        sync.Mutex
	flows     []protocol.EBPFSocketFlow
	metrics   []protocol.TMMDPDKMetric
	aiEvents  []protocol.AIGatewayEvent
	ctx       context.Context
	cancel    context.CancelFunc
	flushChan chan struct{}
	wg        sync.WaitGroup
}

// NewTelemetryRingBuffer creates and starts a new telemetry ring buffer.
func NewTelemetryRingBuffer(cfg RingBufferConfig, cb FlushCallback) *TelemetryRingBuffer {
	if cfg.MaxBatchSize <= 0 {
		cfg.MaxBatchSize = 5000
	}
	if cfg.FlushInterval <= 0 {
		cfg.FlushInterval = 1000 * time.Millisecond
	}

	ctx, cancel := context.WithCancel(context.Background())
	rb := &TelemetryRingBuffer{
		cfg:       cfg,
		callback:  cb,
		flows:     make([]protocol.EBPFSocketFlow, 0, cfg.MaxBatchSize),
		metrics:   make([]protocol.TMMDPDKMetric, 0, cfg.MaxBatchSize),
		aiEvents:  make([]protocol.AIGatewayEvent, 0, cfg.MaxBatchSize),
		ctx:       ctx,
		cancel:    cancel,
		flushChan: make(chan struct{}, 1),
	}

	rb.wg.Add(1)
	go rb.runFlushLoop()

	return rb
}

// Enqueue adds a telemetry batch into the buffer, triggering a flush if capacity is reached.
func (rb *TelemetryRingBuffer) Enqueue(batch protocol.TelemetryBatch) {
	rb.mu.Lock()
	defer rb.mu.Unlock()

	if len(batch.Flows) > 0 {
		rb.flows = append(rb.flows, batch.Flows...)
	}
	if len(batch.Metrics) > 0 {
		rb.metrics = append(rb.metrics, batch.Metrics...)
	}
	if len(batch.AIEvents) > 0 {
		rb.aiEvents = append(rb.aiEvents, batch.AIEvents...)
	}

	totalItems := len(rb.flows) + len(rb.metrics) + len(rb.aiEvents)
	if totalItems >= rb.cfg.MaxBatchSize {
		select {
		case rb.flushChan <- struct{}{}:
		default:
		}
	}
}

// runFlushLoop runs in the background and flushes on timer or trigger.
func (rb *TelemetryRingBuffer) runFlushLoop() {
	defer rb.wg.Done()
	ticker := time.NewTicker(rb.cfg.FlushInterval)
	defer ticker.Stop()

	for {
		select {
		case <-rb.ctx.Done():
			rb.flushNow()
			return
		case <-ticker.C:
			rb.flushNow()
		case <-rb.flushChan:
			rb.flushNow()
		}
	}
}

// flushNow swaps buffers under lock and calls the flush callback.
func (rb *TelemetryRingBuffer) flushNow() {
	rb.mu.Lock()
	if len(rb.flows) == 0 && len(rb.metrics) == 0 && len(rb.aiEvents) == 0 {
		rb.mu.Unlock()
		return
	}

	flowsToFlush := rb.flows
	metricsToFlush := rb.metrics
	eventsToFlush := rb.aiEvents

	rb.flows = make([]protocol.EBPFSocketFlow, 0, rb.cfg.MaxBatchSize)
	rb.metrics = make([]protocol.TMMDPDKMetric, 0, rb.cfg.MaxBatchSize)
	rb.aiEvents = make([]protocol.AIGatewayEvent, 0, rb.cfg.MaxBatchSize)
	rb.mu.Unlock()

	if rb.callback != nil {
		_ = rb.callback(flowsToFlush, metricsToFlush, eventsToFlush)
	}
}

// Flush manually triggers an immediate flush.
func (rb *TelemetryRingBuffer) Flush() {
	rb.flushNow()
}

// Close gracefully stops the buffer and flushes any pending items.
func (rb *TelemetryRingBuffer) Close() error {
	rb.cancel()
	rb.wg.Wait()
	return nil
}
