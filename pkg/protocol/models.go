package protocol

import "time"

// FlowDirection indicates direction of network flow.
type FlowDirection int32

const (
	FlowDirectionUnspecified FlowDirection = 0
	FlowDirectionInbound     FlowDirection = 1
	FlowDirectionOutbound    FlowDirection = 2
)

func (d FlowDirection) String() string {
	switch d {
	case FlowDirectionInbound:
		return "INBOUND"
	case FlowDirectionOutbound:
		return "OUTBOUND"
	default:
		return "UNSPECIFIED"
	}
}

// CommandType defines downlink instructions from console to edge agent.
type CommandType int32

const (
	CommandTypeUnspecified     CommandType = 0
	CommandTypeDriftCheck      CommandType = 1
	CommandTypeBenchmark       CommandType = 2
	CommandTypeConfigReconcile CommandType = 3
	CommandTypeFlush           CommandType = 4
)

func (c CommandType) String() string {
	switch c {
	case CommandTypeDriftCheck:
		return "DRIFT_CHECK"
	case CommandTypeBenchmark:
		return "BENCHMARK"
	case CommandTypeConfigReconcile:
		return "CONFIG_RECONCILE"
	case CommandTypeFlush:
		return "FLUSH"
	default:
		return "UNSPECIFIED"
	}
}

// RegisterStatus is the response status of agent registration.
type RegisterStatus int32

const (
	RegisterStatusUnspecified    RegisterStatus = 0
	RegisterStatusOK             RegisterStatus = 1
	RegisterStatusRejected       RegisterStatus = 2
	RegisterStatusRequireUpgrade RegisterStatus = 3
)

// EBPFSocketFlow represents a socket-level telemetry record collected via eBPF.
type EBPFSocketFlow struct {
	Timestamp           int64         `json:"timestamp"` // Microseconds
	ClusterID           string        `json:"cluster_id"`
	NodeName            string        `json:"node_name"`
	NetNsID             uint32        `json:"net_ns_id"`
	PodName             string        `json:"pod_name"`
	Namespace           string        `json:"namespace"`
	SrcIP               string        `json:"src_ip"`
	SrcPort             uint16        `json:"src_port"`
	DstIP               string        `json:"dst_ip"`
	DstPort             uint16        `json:"dst_port"`
	Direction           FlowDirection `json:"direction"`
	HandshakeDurationUs uint32        `json:"handshake_duration_us"`
	TotalDurationMs     uint32        `json:"total_duration_ms"`
	BytesSent           uint64        `json:"bytes_sent"`
	BytesReceived       uint64        `json:"bytes_received"`
	Retransmissions     uint32        `json:"retransmissions"`
	SmoothedRttUs       uint32        `json:"smoothed_rtt_us"`
	TmmBypassViolation  bool          `json:"tmm_bypass_violation"`
}

// Time converts the microsecond timestamp to time.Time.
func (f *EBPFSocketFlow) Time() time.Time {
	return time.UnixMicro(f.Timestamp)
}

// TMMDPDKMetric represents hardware and DPDK ring metrics from F5 BNK TMM.
type TMMDPDKMetric struct {
	Timestamp                  int64   `json:"timestamp"` // Microseconds
	ClusterID                  string  `json:"cluster_id"`
	NodeName                   string  `json:"node_name"`
	TmmPod                     string  `json:"tmm_pod"`
	CoreID                     uint16  `json:"core_id"`
	Interface                  string  `json:"interface"`
	RxPackets                  uint64  `json:"rx_packets"`
	RxBytes                    uint64  `json:"rx_bytes"`
	RxDrops                    uint64  `json:"rx_drops"`
	TxPackets                  uint64  `json:"tx_packets"`
	TxBytes                    uint64  `json:"tx_bytes"`
	TxDrops                    uint64  `json:"tx_drops"`
	RxRingDescriptorOccupancy  float32 `json:"rx_ring_descriptor_occupancy"`
	TxRingDescriptorOccupancy  float32 `json:"tx_ring_descriptor_occupancy"`
	CPUUtilizationPct          float32 `json:"cpu_utilization_pct"`
	HugepageUsedBytes          uint64  `json:"hugepage_used_bytes"`
}

// Time converts the microsecond timestamp to time.Time.
func (m *TMMDPDKMetric) Time() time.Time {
	return time.UnixMicro(m.Timestamp)
}

// AIGatewayEvent captures LLM token transactions from F5 AI Gateway.
type AIGatewayEvent struct {
	Timestamp          int64   `json:"timestamp"` // Milliseconds
	ClusterID          string  `json:"cluster_id"`
	ClientID           string  `json:"client_id"`
	ModelName          string  `json:"model_name"`
	RouteName          string  `json:"route_name"`
	PromptTokens       uint32  `json:"prompt_tokens"`
	CompletionTokens   uint32  `json:"completion_tokens"`
	TimeToFirstTokenMs uint32  `json:"time_to_first_token_ms"`
	TotalLatencyMs     uint32  `json:"total_latency_ms"`
	StatusCode         uint16  `json:"status_code"`
	CostUSD            float64 `json:"cost_usd"`
}

// Time converts the millisecond timestamp to time.Time.
func (e *AIGatewayEvent) Time() time.Time {
	return time.UnixMilli(e.Timestamp)
}

// TelemetryBatch is the primary payload transmitted by edge agents.
type TelemetryBatch struct {
	BatchID   string            `json:"batch_id"`
	ClusterID string            `json:"cluster_id"`
	NodeName  string            `json:"node_name"`
	SentAt    int64             `json:"sent_at"` // Nanoseconds or Milliseconds
	Flows     []EBPFSocketFlow  `json:"flows,omitempty"`
	Metrics   []TMMDPDKMetric   `json:"metrics,omitempty"`
	AIEvents  []AIGatewayEvent  `json:"ai_events,omitempty"`
	Metadata  map[string]string `json:"metadata,omitempty"`
}

// ControlCommand represents an instruction from the console to the agent.
type ControlCommand struct {
	CommandID string      `json:"command_id"`
	Type      CommandType `json:"type"`
	Payload   string      `json:"payload"`
	CreatedAt int64       `json:"created_at"`
}

// RegisterRequest contains metadata presented during initial handshake.
type RegisterRequest struct {
	ClusterID          string            `json:"cluster_id"`
	ClusterName        string            `json:"cluster_name"`
	AgentVersion       string            `json:"agent_version"`
	Hostname           string            `json:"hostname"`
	NodeName           string            `json:"node_name"`
	Capabilities       []string          `json:"capabilities"`
	MachineFingerprint string            `json:"machine_fingerprint"`
	Labels             map[string]string `json:"labels,omitempty"`
}

// RegisterResponse returns the agent configuration and session details.
type RegisterResponse struct {
	Status               RegisterStatus    `json:"status"`
	AgentID              string            `json:"agent_id"`
	SessionToken         string            `json:"session_token,omitempty"`
	ServerTime           int64             `json:"server_time"`
	HeartbeatIntervalSec uint32            `json:"heartbeat_interval_sec"`
	AssignedConfig       map[string]string `json:"assigned_config,omitempty"`
	Message              string            `json:"message,omitempty"`
}

// Ping is sent periodically by the agent.
type Ping struct {
	ClusterID     string `json:"cluster_id"`
	AgentID       string `json:"agent_id"`
	Timestamp     int64  `json:"timestamp"`
	Status        string `json:"status"`
	UptimeSeconds uint64 `json:"uptime_seconds"`
}

// Pong acknowledges the heartbeat.
type Pong struct {
	ServerTimestamp      int64 `json:"server_timestamp"`
	Ack                  bool  `json:"ack"`
	PendingCommandsCount uint32 `json:"pending_commands_count"`
}
