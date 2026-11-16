package ingest

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/JLCode-tech/bnk-forge/pkg/protocol"
)

// ClickHouseWriter writes batched telemetry records to ClickHouse.
type ClickHouseWriter struct {
	httpURL    string
	user       string
	password   string
	httpClient *http.Client
	mu         sync.RWMutex
	stats      struct {
		FlowsInserted   uint64
		MetricsInserted uint64
		EventsInserted  uint64
		ErrorsCount     uint64
	}
}

// NewClickHouseWriter constructs a new writer pointing to ClickHouse HTTP endpoint (e.g. "http://localhost:8123").
func NewClickHouseWriter(httpURL string) *ClickHouseWriter {
	user := os.Getenv("CLICKHOUSE_USER")
	password := os.Getenv("CLICKHOUSE_PASSWORD")
	return NewClickHouseWriterWithAuth(httpURL, user, password)
}

// NewClickHouseWriterWithAuth constructs a writer with explicit credentials.
func NewClickHouseWriterWithAuth(httpURL, user, password string) *ClickHouseWriter {
	if httpURL == "" {
		httpURL = "http://localhost:8123"
	}
	if !strings.HasPrefix(httpURL, "http://") && !strings.HasPrefix(httpURL, "https://") {
		httpURL = "http://" + httpURL
	}
	if u, err := url.Parse(httpURL); err == nil {
		if u.User != nil {
			if user == "" {
				user = u.User.Username()
			}
			if p, ok := u.User.Password(); ok && password == "" {
				password = p
			}
			u.User = nil
			httpURL = u.String()
		}
	}
	if user == "" {
		user = "default"
	}
	if password == "" {
		password = "bnkforge_dev_password"
	}

	return &ClickHouseWriter{
		httpURL:  httpURL,
		user:     user,
		password: password,
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
			Transport: &http.Transport{
				MaxIdleConns:        100,
				MaxIdleConnsPerHost: 20,
				IdleConnTimeout:     90 * time.Second,
			},
		},
	}
}

func (cw *ClickHouseWriter) setAuthHeaders(req *http.Request) {
	if cw.user != "" {
		req.Header.Set("X-ClickHouse-User", cw.user)
	}
	if cw.password != "" {
		req.Header.Set("X-ClickHouse-Key", cw.password)
	}
}

// InitSchema ensures the `forge` database and target tables exist in ClickHouse.
func (cw *ClickHouseWriter) InitSchema(ctx context.Context) error {
	queries := []string{
		`CREATE DATABASE IF NOT EXISTS forge;`,
		`CREATE TABLE IF NOT EXISTS forge.ebpf_socket_flows (
			timestamp DateTime64(3, 'UTC') CODEC(DoubleDelta, LZ4),
			cluster_id UUID CODEC(ZSTD),
			node_name LowCardinality(String) CODEC(ZSTD),
			net_ns_id UInt32 CODEC(T64, LZ4),
			pod_name LowCardinality(String) CODEC(ZSTD),
			namespace LowCardinality(String) CODEC(ZSTD),
			src_ip IPv6 CODEC(ZSTD),
			src_port UInt16 CODEC(T64, LZ4),
			dst_ip IPv6 CODEC(ZSTD),
			dst_port UInt16 CODEC(T64, LZ4),
			direction Enum8('INBOUND' = 1, 'OUTBOUND' = 2),
			handshake_duration_us UInt32 CODEC(T64, LZ4),
			total_duration_ms UInt32 CODEC(T64, LZ4),
			bytes_sent UInt64 CODEC(T64, LZ4),
			bytes_received UInt64 CODEC(T64, LZ4),
			retransmissions UInt32 CODEC(T64, LZ4),
			smoothed_rtt_us UInt32 CODEC(T64, LZ4),
			tmm_bypass_violation UInt8 CODEC(T64, LZ4)
		) ENGINE = MergeTree()
		PARTITION BY toYYYYMM(timestamp)
		ORDER BY (cluster_id, namespace, pod_name, dst_port, timestamp)
		TTL toDateTime(timestamp) + INTERVAL 30 DAY;`,
		`CREATE TABLE IF NOT EXISTS forge.tmm_dpdk_metrics (
			timestamp DateTime64(3, 'UTC') CODEC(DoubleDelta, LZ4),
			cluster_id UUID CODEC(ZSTD),
			node_name LowCardinality(String) CODEC(ZSTD),
			tmm_pod LowCardinality(String) CODEC(ZSTD),
			core_id UInt16 CODEC(T64, LZ4),
			interface LowCardinality(String) CODEC(ZSTD),
			rx_packets UInt64 CODEC(T64, LZ4),
			rx_bytes UInt64 CODEC(T64, LZ4),
			rx_drops UInt64 CODEC(T64, LZ4),
			tx_packets UInt64 CODEC(T64, LZ4),
			tx_bytes UInt64 CODEC(T64, LZ4),
			tx_drops UInt64 CODEC(T64, LZ4),
			rx_ring_descriptor_occupancy Float32 CODEC(Gorilla, LZ4),
			tx_ring_descriptor_occupancy Float32 CODEC(Gorilla, LZ4),
			cpu_utilization_pct Float32 CODEC(Gorilla, LZ4),
			hugepage_used_bytes UInt64 CODEC(T64, LZ4)
		) ENGINE = MergeTree()
		PARTITION BY toYYYYMM(timestamp)
		ORDER BY (cluster_id, tmm_pod, interface, core_id, timestamp)
		TTL toDateTime(timestamp) + INTERVAL 14 DAY;`,
		`CREATE TABLE IF NOT EXISTS forge.ai_gateway_events (
			timestamp DateTime64(3, 'UTC') CODEC(DoubleDelta, LZ4),
			cluster_id UUID CODEC(ZSTD),
			client_id LowCardinality(String) CODEC(ZSTD),
			model_name LowCardinality(String) CODEC(ZSTD),
			route_name LowCardinality(String) CODEC(ZSTD),
			prompt_tokens UInt32 CODEC(T64, LZ4),
			completion_tokens UInt32 CODEC(T64, LZ4),
			time_to_first_token_ms UInt32 CODEC(T64, LZ4),
			total_latency_ms UInt32 CODEC(T64, LZ4),
			status_code UInt16 CODEC(T64, LZ4),
			cost_usd Float64 CODEC(Gorilla, LZ4)
		) ENGINE = MergeTree()
		PARTITION BY toYYYYMM(timestamp)
		ORDER BY (cluster_id, model_name, client_id, timestamp)
		TTL toDateTime(timestamp) + INTERVAL 90 DAY;`,
	}

	for _, query := range queries {
		if err := cw.execQuery(ctx, query); err != nil {
			return fmt.Errorf("failed executing ClickHouse schema init query: %w", err)
		}
	}
	return nil
}

// execQuery posts a raw SQL query to ClickHouse.
func (cw *ClickHouseWriter) execQuery(ctx context.Context, sql string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, cw.httpURL, strings.NewReader(sql))
	if err != nil {
		return err
	}
	cw.setAuthHeaders(req)
	resp, err := cw.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("clickhouse error (status %d): %s", resp.StatusCode, string(body))
	}
	return nil
}

// BulkInsertFlows inserts a slice of EBPFSocketFlow records into `forge.ebpf_socket_flows`.
func (cw *ClickHouseWriter) BulkInsertFlows(ctx context.Context, flows []protocol.EBPFSocketFlow) error {
	if len(flows) == 0 {
		return nil
	}

	var buf bytes.Buffer
	for _, f := range flows {
		tStr := f.Time().Format("2006-01-02 15:04:05.000")
		row := map[string]interface{}{
			"timestamp":             tStr,
			"cluster_id":            f.ClusterID,
			"node_name":             f.NodeName,
			"net_ns_id":             f.NetNsID,
			"pod_name":              f.PodName,
			"namespace":             f.Namespace,
			"src_ip":                f.SrcIP,
			"src_port":              f.SrcPort,
			"dst_ip":                f.DstIP,
			"dst_port":              f.DstPort,
			"direction":             f.Direction.String(),
			"handshake_duration_us": f.HandshakeDurationUs,
			"total_duration_ms":     f.TotalDurationMs,
			"bytes_sent":            f.BytesSent,
			"bytes_received":        f.BytesReceived,
			"retransmissions":       f.Retransmissions,
			"smoothed_rtt_us":       f.SmoothedRttUs,
			"tmm_bypass_violation":  boolToUint8(f.TmmBypassViolation),
		}
		if data, err := json.Marshal(row); err == nil {
			buf.Write(data)
			buf.WriteByte('\n')
		}
	}

	endpoint := fmt.Sprintf("%s/?query=%s", cw.httpURL, url.QueryEscape("INSERT INTO forge.ebpf_socket_flows FORMAT JSONEachRow"))
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, &buf)
	if err != nil {
		cw.recordError()
		return err
	}
	cw.setAuthHeaders(req)
	req.Header.Set("Content-Type", "application/json")

	resp, err := cw.httpClient.Do(req)
	if err != nil {
		cw.recordError()
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
		cw.recordError()
		return fmt.Errorf("bulk insert flows failed (status %d): %s", resp.StatusCode, string(body))
	}

	cw.mu.Lock()
	cw.stats.FlowsInserted += uint64(len(flows))
	cw.mu.Unlock()
	return nil
}

// BulkInsertMetrics inserts a slice of TMMDPDKMetric records into `forge.tmm_dpdk_metrics`.
func (cw *ClickHouseWriter) BulkInsertMetrics(ctx context.Context, metrics []protocol.TMMDPDKMetric) error {
	if len(metrics) == 0 {
		return nil
	}

	var buf bytes.Buffer
	for _, m := range metrics {
		tStr := m.Time().Format("2006-01-02 15:04:05.000")
		row := map[string]interface{}{
			"timestamp":                    tStr,
			"cluster_id":                   m.ClusterID,
			"node_name":                    m.NodeName,
			"tmm_pod":                      m.TmmPod,
			"core_id":                      m.CoreID,
			"interface":                    m.Interface,
			"rx_packets":                   m.RxPackets,
			"rx_bytes":                     m.RxBytes,
			"rx_drops":                     m.RxDrops,
			"tx_packets":                   m.TxPackets,
			"tx_bytes":                     m.TxBytes,
			"tx_drops":                     m.TxDrops,
			"rx_ring_descriptor_occupancy": m.RxRingDescriptorOccupancy,
			"tx_ring_descriptor_occupancy": m.TxRingDescriptorOccupancy,
			"cpu_utilization_pct":          m.CPUUtilizationPct,
			"hugepage_used_bytes":          m.HugepageUsedBytes,
		}
		if data, err := json.Marshal(row); err == nil {
			buf.Write(data)
			buf.WriteByte('\n')
		}
	}

	endpoint := fmt.Sprintf("%s/?query=%s", cw.httpURL, url.QueryEscape("INSERT INTO forge.tmm_dpdk_metrics FORMAT JSONEachRow"))
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, &buf)
	if err != nil {
		cw.recordError()
		return err
	}
	cw.setAuthHeaders(req)
	req.Header.Set("Content-Type", "application/json")

	resp, err := cw.httpClient.Do(req)
	if err != nil {
		cw.recordError()
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
		cw.recordError()
		return fmt.Errorf("bulk insert metrics failed (status %d): %s", resp.StatusCode, string(body))
	}

	cw.mu.Lock()
	cw.stats.MetricsInserted += uint64(len(metrics))
	cw.mu.Unlock()
	return nil
}

// BulkInsertAIEvents inserts a slice of AIGatewayEvent records into `forge.ai_gateway_events`.
func (cw *ClickHouseWriter) BulkInsertAIEvents(ctx context.Context, events []protocol.AIGatewayEvent) error {
	if len(events) == 0 {
		return nil
	}

	var buf bytes.Buffer
	for _, e := range events {
		tStr := e.Time().Format("2006-01-02 15:04:05.000")
		row := map[string]interface{}{
			"timestamp":              tStr,
			"cluster_id":             e.ClusterID,
			"client_id":              e.ClientID,
			"model_name":             e.ModelName,
			"route_name":             e.RouteName,
			"prompt_tokens":          e.PromptTokens,
			"completion_tokens":      e.CompletionTokens,
			"time_to_first_token_ms": e.TimeToFirstTokenMs,
			"total_latency_ms":       e.TotalLatencyMs,
			"status_code":            e.StatusCode,
			"cost_usd":               e.CostUSD,
		}
		if data, err := json.Marshal(row); err == nil {
			buf.Write(data)
			buf.WriteByte('\n')
		}
	}

	endpoint := fmt.Sprintf("%s/?query=%s", cw.httpURL, url.QueryEscape("INSERT INTO forge.ai_gateway_events FORMAT JSONEachRow"))
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, &buf)
	if err != nil {
		cw.recordError()
		return err
	}
	cw.setAuthHeaders(req)
	req.Header.Set("Content-Type", "application/json")

	resp, err := cw.httpClient.Do(req)
	if err != nil {
		cw.recordError()
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
		cw.recordError()
		return fmt.Errorf("bulk insert AI events failed (status %d): %s", resp.StatusCode, string(body))
	}

	cw.mu.Lock()
	cw.stats.EventsInserted += uint64(len(events))
	cw.mu.Unlock()
	return nil
}

func (cw *ClickHouseWriter) recordError() {
	cw.mu.Lock()
	cw.stats.ErrorsCount++
	cw.mu.Unlock()
}

// Stats returns current ingestion statistics.
func (cw *ClickHouseWriter) Stats() (flows, metrics, events, errors uint64) {
	cw.mu.RLock()
	defer cw.mu.RUnlock()
	return cw.stats.FlowsInserted, cw.stats.MetricsInserted, cw.stats.EventsInserted, cw.stats.ErrorsCount
}

func boolToUint8(b bool) uint8 {
	if b {
		return 1
	}
	return 0
}
