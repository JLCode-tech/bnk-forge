package protocol

import (
	"encoding/json"
	"testing"
	"time"
)

func TestSerializationRoundTrip(t *testing.T) {
	now := time.Now().UTC()
	flow := EBPFSocketFlow{
		Timestamp:           now.UnixMicro(),
		ClusterID:           "cls-12345",
		NodeName:            "node-alpha",
		NetNsID:             4026532184,
		PodName:             "inference-pod-xyz",
		Namespace:           "ai-prod",
		SrcIP:               "10.244.1.15",
		SrcPort:             54321,
		DstIP:               "10.244.2.80",
		DstPort:             8000,
		Direction:           FlowDirectionOutbound,
		HandshakeDurationUs: 1250,
		TotalDurationMs:     450,
		BytesSent:           1048576,
		BytesReceived:       2097152,
		Retransmissions:     0,
		SmoothedRttUs:       450,
		TmmBypassViolation:  false,
	}

	metric := TMMDPDKMetric{
		Timestamp:                 now.UnixMicro(),
		ClusterID:                 "cls-12345",
		NodeName:                  "node-alpha",
		TmmPod:                    "f5-tmm-worker-0",
		CoreID:                    2,
		Interface:                 "1.1",
		RxPackets:                 1500000,
		RxBytes:                   1500000000,
		RxDrops:                   0,
		TxPackets:                 1499990,
		TxBytes:                   1499990000,
		TxDrops:                   10,
		RxRingDescriptorOccupancy: 0.12,
		TxRingDescriptorOccupancy: 0.15,
		CPUUtilizationPct:         42.5,
		HugepageUsedBytes:         1073741824,
	}

	aiEvent := AIGatewayEvent{
		Timestamp:          now.UnixMilli(),
		ClusterID:          "cls-12345",
		ClientID:           "tenant-fintech",
		ModelName:          "claude-3-5-sonnet",
		RouteName:          "prod-inference-route",
		PromptTokens:       150,
		CompletionTokens:   350,
		TimeToFirstTokenMs: 280,
		TotalLatencyMs:     890,
		StatusCode:         200,
		CostUSD:            0.0054,
	}

	batch := TelemetryBatch{
		BatchID:   "batch-001",
		ClusterID: "cls-12345",
		NodeName:  "node-alpha",
		SentAt:    now.UnixNano(),
		Flows:     []EBPFSocketFlow{flow},
		Metrics:   []TMMDPDKMetric{metric},
		AIEvents:  []AIGatewayEvent{aiEvent},
		Metadata: map[string]string{
			"agent_version": "v1.0.0-pov",
			"kernel":        "6.1.0-eks",
		},
	}

	data, err := json.Marshal(batch)
	if err != nil {
		t.Fatalf("Failed to marshal TelemetryBatch: %v", err)
	}

	var decoded TelemetryBatch
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("Failed to unmarshal TelemetryBatch: %v", err)
	}

	if decoded.BatchID != batch.BatchID {
		t.Errorf("Expected BatchID %s, got %s", batch.BatchID, decoded.BatchID)
	}
	if len(decoded.Flows) != 1 || decoded.Flows[0].PodName != "inference-pod-xyz" {
		t.Errorf("Flow decode mismatch: %+v", decoded.Flows)
	}
	if len(decoded.Metrics) != 1 || decoded.Metrics[0].TmmPod != "f5-tmm-worker-0" {
		t.Errorf("Metric decode mismatch: %+v", decoded.Metrics)
	}
	if len(decoded.AIEvents) != 1 || decoded.AIEvents[0].ModelName != "claude-3-5-sonnet" {
		t.Errorf("AI Event decode mismatch: %+v", decoded.AIEvents)
	}
	if decoded.Flows[0].Direction.String() != "OUTBOUND" {
		t.Errorf("Expected direction OUTBOUND, got %s", decoded.Flows[0].Direction)
	}
}

func TestControlCommandAndPingPong(t *testing.T) {
	cmd := ControlCommand{
		CommandID: "cmd-001",
		Type:      CommandTypeBenchmark,
		Payload:   `{"scenario": "burst-1k"}`,
		CreatedAt: time.Now().Unix(),
	}
	if cmd.Type.String() != "BENCHMARK" {
		t.Errorf("Expected BENCHMARK, got %s", cmd.Type.String())
	}

	ping := Ping{
		ClusterID:     "cls-99",
		AgentID:       "agent-abc",
		Timestamp:     time.Now().Unix(),
		Status:        "HEALTHY",
		UptimeSeconds: 3600,
	}
	pong := Pong{
		ServerTimestamp:      time.Now().Unix(),
		Ack:                  true,
		PendingCommandsCount: 0,
	}
	pBytes, _ := json.Marshal(ping)
	var pingDecoded Ping
	_ = json.Unmarshal(pBytes, &pingDecoded)
	if pingDecoded.AgentID != ping.AgentID {
		t.Errorf("Ping decode error: %+v", pingDecoded)
	}

	pongBytes, _ := json.Marshal(pong)
	var pongDecoded Pong
	_ = json.Unmarshal(pongBytes, &pongDecoded)
	if !pongDecoded.Ack {
		t.Errorf("Pong decode error: %+v", pongDecoded)
	}
}
