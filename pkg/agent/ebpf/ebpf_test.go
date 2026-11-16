package ebpf

import (
	"context"
	"testing"
	"time"

	"github.com/JLCode-tech/bnk-forge/pkg/protocol"
)

func TestDriftDetector(t *testing.T) {
	detector := NewDriftDetector(DriftConfig{
		TmmGatewayIPs:       []string{"10.244.0.50", "192.168.1.10"},
		ProtectedNamespaces: []string{"ai-inference"},
		ProtectedPorts:      []uint16{8000, 8080},
	})

	// 1. Compliant flow: arrives from TMM Gateway to port 8000
	compliant := protocol.EBPFSocketFlow{
		SrcIP:     "10.244.0.50",
		DstIP:     "10.244.1.20",
		DstPort:   8000,
		Namespace: "ai-inference",
		Direction: protocol.FlowDirectionInbound,
	}
	if detector.CheckBypass(compliant) {
		t.Errorf("expected compliant flow to NOT be flagged as bypass")
	}

	// 2. Bypass violation: arrives directly from external IP to port 8000
	bypass := protocol.EBPFSocketFlow{
		SrcIP:     "172.16.0.99",
		DstIP:     "10.244.1.20",
		DstPort:   8000,
		Namespace: "ai-inference",
		Direction: protocol.FlowDirectionInbound,
	}
	if !detector.CheckBypass(bypass) {
		t.Errorf("expected bypass flow to be flagged as violation")
	}

	// 3. Localhost health check loopback
	loopback := protocol.EBPFSocketFlow{
		SrcIP:     "127.0.0.1",
		DstIP:     "127.0.0.1",
		DstPort:   8000,
		Namespace: "ai-inference",
		Direction: protocol.FlowDirectionInbound,
	}
	if detector.CheckBypass(loopback) {
		t.Errorf("loopback traffic should never be flagged as bypass")
	}

	// 4. Outbound connection
	outbound := protocol.EBPFSocketFlow{
		SrcIP:     "10.244.1.20",
		DstIP:     "172.16.0.99",
		DstPort:   8000,
		Namespace: "ai-inference",
		Direction: protocol.FlowDirectionOutbound,
	}
	if detector.CheckBypass(outbound) {
		t.Errorf("outbound traffic should not be flagged as bypass")
	}

	// 5. Unprotected port (e.g. metrics port 9090)
	unprotected := protocol.EBPFSocketFlow{
		SrcIP:     "172.16.0.99",
		DstIP:     "10.244.1.20",
		DstPort:   9090,
		Namespace: "ai-inference",
		Direction: protocol.FlowDirectionInbound,
	}
	if detector.CheckBypass(unprotected) {
		t.Errorf("unprotected port flow should not be flagged as bypass")
	}
}

func TestSocketObserverLifecycle(t *testing.T) {
	observer := NewSocketObserver(Config{
		ClusterID:                 "cluster-alpha",
		NodeName:                  "node-01",
		TmmGatewayIPs:             []string{"10.244.0.50"},
		ProtectedNamespaces:       []string{"ai-inference"},
		ProtectedPorts:            []uint16{8000},
		MockMode:                  true,
		SyntheticEmissionInterval: 20 * time.Millisecond,
	})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	if err := observer.Start(ctx); err != nil {
		t.Fatalf("observer Start failed: %v", err)
	}

	var flows []protocol.EBPFSocketFlow
	timeout := time.After(300 * time.Millisecond)

collect:
	for {
		select {
		case f := <-observer.Flows():
			flows = append(flows, f)
			if len(flows) >= 6 {
				break collect
			}
		case <-timeout:
			break collect
		}
	}

	if len(flows) < 5 {
		t.Fatalf("expected at least 5 flows emitted, got %d", len(flows))
	}

	// Verify metadata enrichment
	for _, f := range flows {
		if f.ClusterID != "cluster-alpha" {
			t.Errorf("expected ClusterID cluster-alpha, got %s", f.ClusterID)
		}
		if f.NodeName != "node-01" {
			t.Errorf("expected NodeName node-01, got %s", f.NodeName)
		}
		if f.Timestamp == 0 {
			t.Errorf("expected non-zero Timestamp")
		}
	}

	// Verify that at least one flow triggered bypass detection (every 5th step)
	hasViolation := false
	for _, f := range flows {
		if f.TmmBypassViolation {
			hasViolation = true
			break
		}
	}
	if !hasViolation {
		t.Errorf("expected at least one TmmBypassViolation among flows")
	}

	// Clean shutdown
	if err := observer.Stop(); err != nil {
		t.Fatalf("observer Stop failed: %v", err)
	}
}
