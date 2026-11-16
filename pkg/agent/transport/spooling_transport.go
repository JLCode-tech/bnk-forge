package transport

import (
	"context"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/JLCode-tech/bnk-forge/pkg/protocol"
)

// SpoolingTransport combines a live network Transport with an on-disk Spool WAL.
type SpoolingTransport struct {
	inner        Transport
	spool        DiskSpool
	drainNotify  chan struct{}
	drainStop    chan struct{}
	drainDone    chan struct{}
	drainTimeout time.Duration
	mu           sync.Mutex
	closed       bool
}

// NewSpoolingTransport creates a resilient transport wrapper.
func NewSpoolingTransport(inner Transport, spool DiskSpool) *SpoolingTransport {
	st := &SpoolingTransport{
		inner:        inner,
		spool:        spool,
		drainNotify:  make(chan struct{}, 1),
		drainStop:    make(chan struct{}),
		drainDone:    make(chan struct{}),
		drainTimeout: 5 * time.Second,
	}

	go st.runDrainLoop()
	return st
}

// StreamBatch transmits a batch directly if possible, or buffers to disk if unreachable.
func (t *SpoolingTransport) StreamBatch(ctx context.Context, batch *protocol.TelemetryBatch) error {
	t.mu.Lock()
	if t.closed {
		t.mu.Unlock()
		return fmt.Errorf("transport is closed")
	}

	// If spool already has items, maintain chronological order by enqueuing
	if t.spool.Len() > 0 {
		if err := t.spool.Enqueue(batch); err != nil {
			t.mu.Unlock()
			return fmt.Errorf("failed enqueuing batch to existing spool: %w", err)
		}
		t.mu.Unlock()
		t.triggerDrain()
		return nil
	}
	t.mu.Unlock()

	// Attempt direct stream
	err := t.inner.StreamBatch(ctx, batch)
	if err == nil {
		return nil
	}

	log.Printf("[Transport] Direct batch stream failed (%v), spooling to disk WAL", err)

	// Direct stream failed: spool to disk
	t.mu.Lock()
	defer t.mu.Unlock()
	if err := t.spool.Enqueue(batch); err != nil {
		return fmt.Errorf("failed spooling batch after transmission error: %w", err)
	}

	t.triggerDrain()
	return nil
}

// Register delegates to the inner transport.
func (t *SpoolingTransport) Register(ctx context.Context, req *protocol.RegisterRequest) (*protocol.RegisterResponse, error) {
	return t.inner.Register(ctx, req)
}

// SendHeartbeat delegates to the inner transport.
func (t *SpoolingTransport) SendHeartbeat(ctx context.Context, ping *protocol.Ping) (*protocol.Pong, error) {
	return t.inner.SendHeartbeat(ctx, ping)
}

// Ping delegates to the inner transport.
func (t *SpoolingTransport) Ping(ctx context.Context) error {
	return t.inner.Ping(ctx)
}

// SpoolLen returns current number of batches stored in disk WAL.
func (t *SpoolingTransport) SpoolLen() int {
	return t.spool.Len()
}

// SpoolBytes returns current disk usage of the spool.
func (t *SpoolingTransport) SpoolBytes() int64 {
	return t.spool.ByteSize()
}

func (t *SpoolingTransport) triggerDrain() {
	select {
	case t.drainNotify <- struct{}{}:
	default:
	}
}

func (t *SpoolingTransport) runDrainLoop() {
	defer close(t.drainDone)
	ticker := time.NewTicker(3 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-t.drainStop:
			return
		case <-t.drainNotify:
			t.drainSpool()
		case <-ticker.C:
			if t.spool.Len() > 0 {
				t.drainSpool()
			}
		}
	}
}

func (t *SpoolingTransport) drainSpool() {
	ctx, cancel := context.WithTimeout(context.Background(), t.drainTimeout)
	defer cancel()

	// First verify if gateway is reachable
	if err := t.inner.Ping(ctx); err != nil {
		return
	}

	for t.spool.Len() > 0 {
		select {
		case <-t.drainStop:
			return
		default:
		}

		batch, err := t.spool.Peek()
		if err != nil || batch == nil {
			break
		}

		sendCtx, sendCancel := context.WithTimeout(context.Background(), t.drainTimeout)
		err = t.inner.StreamBatch(sendCtx, batch)
		sendCancel()

		if err != nil {
			log.Printf("[Transport] Drain replay halted: %v", err)
			return
		}

		// Successfully sent, advance queue
		_, _ = t.spool.Dequeue()
	}
}

// Close gracefully terminates the draining loop and inner transport.
func (t *SpoolingTransport) Close() error {
	t.mu.Lock()
	if t.closed {
		t.mu.Unlock()
		return nil
	}
	t.closed = true
	t.mu.Unlock()

	close(t.drainStop)
	<-t.drainDone

	// Best-effort flush of remaining batches if gateway is reachable
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := t.inner.Ping(ctx); err == nil {
		for t.spool.Len() > 0 {
			batch, err := t.spool.Peek()
			if err != nil || batch == nil {
				break
			}
			if err := t.inner.StreamBatch(ctx, batch); err != nil {
				break
			}
			_, _ = t.spool.Dequeue()
		}
	}

	_ = t.spool.Close()
	return t.inner.Close()
}
