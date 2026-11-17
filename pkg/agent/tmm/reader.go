package tmm

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"math/rand"
	"net"
	"time"

	"github.com/JLCode-tech/bnk-forge/pkg/protocol"
)

func (h *DPDKHarvester) runLoop(ctx context.Context) {
	defer close(h.doneChan)

	ticker := time.NewTicker(h.cfg.PollInterval)
	defer ticker.Stop()

	// Initial poll on startup
	h.poll(ctx)

	for {
		select {
		case <-ctx.Done():
			return
		case <-h.stopChan:
			return
		case <-ticker.C:
			h.poll(ctx)
		}
	}
}

func (h *DPDKHarvester) poll(ctx context.Context) {
	// Only emit synthetic DPDK metrics when mock mode is explicitly enabled.
	if h.cfg.MockMode {
		h.pollSynthetic()
		return
	}

	if h.cfg.SocketPath == "" && h.cfg.Dialer == nil {
		return
	}

	// Read from live UDS socket if available; skip silently on non-TMM/non-DPDK nodes.
	_ = h.pollUDS(ctx)
}

func (h *DPDKHarvester) pollUDS(ctx context.Context) error {
	var conn net.Conn
	var err error

	if h.cfg.Dialer != nil {
		conn, err = h.cfg.Dialer(ctx)
	} else {
		dialer := net.Dialer{Timeout: 500 * time.Millisecond}
		conn, err = dialer.DialContext(ctx, "unix", h.cfg.SocketPath)
	}

	if err != nil {
		return fmt.Errorf("failed connecting to TMM socket %s: %w", h.cfg.SocketPath, err)
	}
	defer conn.Close()

	// Send stats inquiry command
	if _, err := conn.Write([]byte("GET /telemetry/dpdk\n")); err != nil {
		return fmt.Errorf("failed writing query to TMM socket: %w", err)
	}

	_ = conn.SetReadDeadline(time.Now().Add(1 * time.Second))
	scanner := bufio.NewScanner(conn)

	found := false
	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}

		var m protocol.TMMDPDKMetric
		if err := json.Unmarshal(line, &m); err == nil {
			h.emitMetric(m)
			found = true
		}
	}

	if err := scanner.Err(); err != nil {
		return err
	}
	if !found {
		return fmt.Errorf("no valid telemetry lines read from socket")
	}

	return nil
}

func (h *DPDKHarvester) pollSynthetic() {
	now := time.Now().UnixMicro()
	interfaces := []string{"1.1", "1.2"}

	for coreID := uint16(0); coreID < 2; coreID++ {
		for _, iface := range interfaces {
			rxPackets := uint64(50000 + rand.Intn(10000))
			txPackets := uint64(48000 + rand.Intn(10000))

			// Typically 0 drops, occasional drop during congestion spikes
			var rxDrops uint64
			if rand.Float32() < 0.05 {
				rxDrops = uint64(rand.Intn(5) + 1)
			}

			metric := protocol.TMMDPDKMetric{
				Timestamp:                 now,
				ClusterID:                 h.cfg.ClusterID,
				NodeName:                  h.cfg.NodeName,
				TmmPod:                    h.cfg.TmmPod,
				CoreID:                    coreID,
				Interface:                 iface,
				RxPackets:                 rxPackets,
				RxBytes:                   rxPackets * 1420,
				RxDrops:                   rxDrops,
				TxPackets:                 txPackets,
				TxBytes:                   txPackets * 1420,
				TxDrops:                   0,
				RxRingDescriptorOccupancy: float32(0.15 + (rand.Float32() * 0.25)),
				TxRingDescriptorOccupancy: float32(0.10 + (rand.Float32() * 0.20)),
				CPUUtilizationPct:         float32(20.0 + (rand.Float32() * 30.0)),
				HugepageUsedBytes:         1024 * 1024 * 1024 * 2, // 2GB
			}

			h.emitMetric(metric)
		}
	}
}
