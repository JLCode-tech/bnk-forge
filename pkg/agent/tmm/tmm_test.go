package tmm

import (
	"context"
	"encoding/json"
	"net"
	"testing"
	"time"

	"github.com/JLCode-tech/bnk-forge/pkg/protocol"
)

func TestDPDKHarvesterSynthetic(t *testing.T) {
	harvester := NewDPDKHarvester(Config{
		ClusterID:    "test-cluster",
		NodeName:     "node-01",
		TmmPod:       "f5-tmm-worker",
		PollInterval: 20 * time.Millisecond,
		MockMode:     true,
	})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	if err := harvester.Start(ctx); err != nil {
		t.Fatalf("Start failed: %v", err)
	}

	var metrics []protocol.TMMDPDKMetric
	timeout := time.After(200 * time.Millisecond)

collect:
	for {
		select {
		case m := <-harvester.Metrics():
			metrics = append(metrics, m)
			if len(metrics) >= 4 {
				break collect
			}
		case <-timeout:
			break collect
		}
	}

	if len(metrics) < 4 {
		t.Fatalf("expected at least 4 metrics emitted, got %d", len(metrics))
	}

	for _, m := range metrics {
		if m.ClusterID != "test-cluster" {
			t.Errorf("expected ClusterID test-cluster, got %s", m.ClusterID)
		}
		if m.NodeName != "node-01" {
			t.Errorf("expected NodeName node-01, got %s", m.NodeName)
		}
		if m.TmmPod != "f5-tmm-worker" {
			t.Errorf("expected TmmPod f5-tmm-worker, got %s", m.TmmPod)
		}
		if m.RxPackets == 0 || m.TxPackets == 0 {
			t.Errorf("expected non-zero rx/tx packets")
		}
		if m.HugepageUsedBytes == 0 {
			t.Errorf("expected non-zero HugepageUsedBytes")
		}
	}

	if err := harvester.Stop(); err != nil {
		t.Fatalf("Stop failed: %v", err)
	}
}

func TestDPDKHarvesterUDS(t *testing.T) {
	// Create simulated in-memory duplex connection using net.Pipe
	clientConn, serverConn := net.Pipe()

	go func() {
		defer serverConn.Close()
		buf := make([]byte, 128)
		_, _ = serverConn.Read(buf)
		metric := protocol.TMMDPDKMetric{
			Timestamp:                 time.Now().UnixMicro(),
			ClusterID:                 "custom-cluster",
			NodeName:                  "uds-node",
			TmmPod:                    "live-tmm-0",
			CoreID:                    3,
			Interface:                 "1.5",
			RxPackets:                 999999,
			RxBytes:                   999999 * 1500,
			RxDrops:                   2,
			TxPackets:                 888888,
			TxBytes:                   888888 * 1500,
			TxDrops:                   0,
			RxRingDescriptorOccupancy: 0.85,
			TxRingDescriptorOccupancy: 0.40,
			CPUUtilizationPct:         78.5,
			HugepageUsedBytes:         4 * 1024 * 1024 * 1024,
		}
		data, _ := json.Marshal(metric)
		_, _ = serverConn.Write(append(data, '\n'))
	}()

	harvester := NewDPDKHarvester(Config{
		ClusterID: "custom-cluster",
		NodeName:  "uds-node",
		Dialer: func(ctx context.Context) (net.Conn, error) {
			return clientConn, nil
		},
		PollInterval: 50 * time.Millisecond,
		MockMode:     false,
	})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	if err := harvester.Start(ctx); err != nil {
		t.Fatalf("Start failed: %v", err)
	}

	select {
	case m := <-harvester.Metrics():
		if m.CoreID != 3 || m.Interface != "1.5" || m.RxPackets != 999999 {
			t.Fatalf("unexpected metric received over UDS: %+v", m)
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatalf("timed out waiting for metric from UDS socket")
	}

	_ = harvester.Stop()
}
