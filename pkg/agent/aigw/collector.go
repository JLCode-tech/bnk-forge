package aigw

import (
	"bufio"
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/JLCode-tech/bnk-forge/pkg/protocol"
)

const (
	defaultClickHouseURL  = "http://f5-aigateway-clickhouse.f5-cne-system.svc.cluster.local:8123"
	defaultClickHouseUser = "otel"
	defaultPollInterval   = 10 * time.Second
	defaultLookback       = 2 * time.Hour
)

// Config configures the AI Gateway telemetry collector.
type Config struct {
	ClusterID          string
	ClickHouseURL      string
	ClickHouseUser     string
	ClickHousePassword string
	PollInterval       time.Duration
	MockMode           bool
	IsLeader           func() bool
	KubeAPIServer      string
	TokenPath          string
	CAPath             string
	InsecureSkipTLS    bool
	HTTPClient         *http.Client
	KubeHTTPClient     *http.Client
}

// Collector polls F5 AI Gateway ClickHouse (otel.aigw_requests) and emits AIGatewayEvent records.
type Collector struct {
	cfg        Config
	httpClient *http.Client
	kubeClient *http.Client
	kubeToken  string

	mu          sync.Mutex
	running     bool
	cachedPass  string
	lastTsMs    int64
	warnedNoSec bool
	warnedHTTP  bool
	stopChan    chan struct{}
	doneChan    chan struct{}
	eventsChan  chan protocol.AIGatewayEvent
}

// NewCollector constructs a new AI Gateway Collector.
func NewCollector(cfg Config) *Collector {
	if cfg.ClickHouseURL == "" {
		cfg.ClickHouseURL = defaultClickHouseURL
	}
	cfg.ClickHouseURL = strings.TrimRight(cfg.ClickHouseURL, "/")
	if cfg.ClickHouseUser == "" {
		cfg.ClickHouseUser = defaultClickHouseUser
	}
	if cfg.PollInterval <= 0 {
		cfg.PollInterval = defaultPollInterval
	}
	if cfg.TokenPath == "" {
		cfg.TokenPath = "/var/run/secrets/kubernetes.io/serviceaccount/token"
	}
	if cfg.CAPath == "" {
		cfg.CAPath = "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt"
	}
	if cfg.KubeAPIServer == "" {
		host := os.Getenv("KUBERNETES_SERVICE_HOST")
		port := os.Getenv("KUBERNETES_SERVICE_PORT")
		if host != "" && port != "" {
			cfg.KubeAPIServer = fmt.Sprintf("https://%s:%s", host, port)
		} else {
			cfg.KubeAPIServer = "https://kubernetes.default.svc"
		}
	}

	httpClient := cfg.HTTPClient
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 5 * time.Second}
	}

	kubeClient := cfg.KubeHTTPClient
	var kubeToken string
	if kubeClient == nil {
		tlsConf := &tls.Config{InsecureSkipVerify: cfg.InsecureSkipTLS}
		if caBytes, err := os.ReadFile(cfg.CAPath); err == nil {
			pool := x509.NewCertPool()
			pool.AppendCertsFromPEM(caBytes)
			tlsConf.RootCAs = pool
		}
		kubeClient = &http.Client{
			Timeout:   5 * time.Second,
			Transport: &http.Transport{TLSClientConfig: tlsConf},
		}
	}
	if tokenBytes, err := os.ReadFile(cfg.TokenPath); err == nil {
		kubeToken = string(bytes.TrimSpace(tokenBytes))
	}

	return &Collector{
		cfg:        cfg,
		httpClient: httpClient,
		kubeClient: kubeClient,
		kubeToken:  kubeToken,
		cachedPass: cfg.ClickHousePassword,
		lastTsMs:   time.Now().Add(-defaultLookback).UnixMilli(),
		stopChan:   make(chan struct{}),
		doneChan:   make(chan struct{}),
		eventsChan: make(chan protocol.AIGatewayEvent, 2000),
	}
}

// Events returns the read-only channel of collected AIGatewayEvent records.
func (c *Collector) Events() <-chan protocol.AIGatewayEvent {
	return c.eventsChan
}

// Start begins periodic polling of AI Gateway telemetry.
func (c *Collector) Start(ctx context.Context) error {
	c.mu.Lock()
	if c.running {
		c.mu.Unlock()
		return nil
	}
	c.running = true
	c.mu.Unlock()

	go c.runLoop(ctx)
	return nil
}

// Stop terminates the collector loop.
func (c *Collector) Stop() error {
	c.mu.Lock()
	if !c.running {
		c.mu.Unlock()
		return nil
	}
	c.running = false
	c.mu.Unlock()

	close(c.stopChan)
	<-c.doneChan
	return nil
}

func (c *Collector) runLoop(ctx context.Context) {
	defer close(c.doneChan)

	ticker := time.NewTicker(c.cfg.PollInterval)
	defer ticker.Stop()

	// Initial poll shortly after startup (after lease election has a chance to settle)
	select {
	case <-ctx.Done():
		return
	case <-c.stopChan:
		return
	case <-time.After(3 * time.Second):
		c.pollOnce(ctx)
	}

	for {
		select {
		case <-ctx.Done():
			return
		case <-c.stopChan:
			return
		case <-ticker.C:
			c.pollOnce(ctx)
		}
	}
}

type chRequestRow struct {
	TsMs               int64   `json:"ts_ms"`
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

func (c *Collector) pollOnce(ctx context.Context) {
	if c.cfg.IsLeader != nil && !c.cfg.IsLeader() {
		return
	}

	if c.cfg.MockMode {
		c.emitMockEvent()
		return
	}

	pass := c.resolvePassword(ctx)
	if pass == "" {
		return
	}

	c.mu.Lock()
	sinceMs := c.lastTsMs
	c.mu.Unlock()

	sql := fmt.Sprintf(
		"SELECT ts_ms, "+
			"if(principal_id != '', principal_id, if(vk_id != '', vk_id, 'unknown')) AS client_id, "+
			"if(model != '', model, if(served_model != '', served_model, 'unknown')) AS model_name, "+
			"if(org_id != '', org_id, if(provider != '', provider, 'default')) AS route_name, "+
			"toUInt32(greatest(prompt_tokens, 0)) AS prompt_tokens, "+
			"toUInt32(greatest(completion_tokens, 0)) AS completion_tokens, "+
			"toUInt32(if(gen_ai.f5.latency_ttft_us > 0, intDiv(gen_ai.f5.latency_ttft_us, 1000), 0)) AS time_to_first_token_ms, "+
			"toUInt32(greatest(latency_ms, 0)) AS total_latency_ms, "+
			"toUInt16(greatest(http_status, 0)) AS status_code, "+
			"cost_usd_micros / 1000000.0 AS cost_usd "+
			"FROM otel.aigw_requests "+
			"WHERE ts_ms > %d "+
			"ORDER BY ts_ms ASC "+
			"LIMIT 1000 "+
			"FORMAT JSONEachRow "+
			"SETTINGS output_format_json_quote_64bit_integers=0",
		sinceMs,
	)

	endpoint := fmt.Sprintf("%s/?query=%s", c.cfg.ClickHouseURL, url.QueryEscape(sql))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return
	}
	req.Header.Set("X-ClickHouse-User", c.cfg.ClickHouseUser)
	req.Header.Set("X-ClickHouse-Key", pass)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		c.mu.Lock()
		if !c.warnedHTTP {
			c.warnedHTTP = true
			log.Printf("[aigw-collector] ClickHouse request failed (%s): %v", c.cfg.ClickHouseURL, err)
		}
		c.mu.Unlock()
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		log.Printf("[aigw-collector] ClickHouse auth rejected (%d); clearing cached password for refresh", resp.StatusCode)
		c.mu.Lock()
		if c.cfg.ClickHousePassword == "" {
			c.cachedPass = ""
		}
		c.mu.Unlock()
		return
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		log.Printf("[aigw-collector] ClickHouse query error %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
		return
	}

	var maxTs int64 = sinceMs
	emitted := 0
	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var row chRequestRow
		if err := json.Unmarshal([]byte(line), &row); err != nil {
			log.Printf("[aigw-collector] JSON decode error: %v (line=%s)", err, line)
			continue
		}
		if row.TsMs > maxTs {
			maxTs = row.TsMs
		}
		ev := protocol.AIGatewayEvent{
			Timestamp:          row.TsMs,
			ClusterID:          c.cfg.ClusterID,
			ClientID:           row.ClientID,
			ModelName:          row.ModelName,
			RouteName:          row.RouteName,
			PromptTokens:       row.PromptTokens,
			CompletionTokens:   row.CompletionTokens,
			TimeToFirstTokenMs: row.TimeToFirstTokenMs,
			TotalLatencyMs:     row.TotalLatencyMs,
			StatusCode:         row.StatusCode,
			CostUSD:            row.CostUSD,
		}
		select {
		case c.eventsChan <- ev:
			emitted++
		default:
			// Drop if channel is full to avoid blocking the collector
		}
	}

	if maxTs > sinceMs {
		c.mu.Lock()
		c.lastTsMs = maxTs
		c.mu.Unlock()
	}
	if emitted > 0 {
		log.Printf("[aigw-collector] Collected %d AI Gateway events (watermark ts_ms=%d)", emitted, maxTs)
	}
}

func (c *Collector) resolvePassword(ctx context.Context) string {
	c.mu.Lock()
	if c.cachedPass != "" {
		p := c.cachedPass
		c.mu.Unlock()
		return p
	}
	c.mu.Unlock()

	if c.kubeToken == "" {
		return ""
	}

	type secretRef struct {
		ns   string
		name string
		key  string
	}
	refs := []secretRef{
		{ns: "f5-cne-system", name: "f5-aigateway-clickhouse-auth", key: "password"},
		{ns: "default", name: "bnk-aigw-virtual-keys", key: "CLICKHOUSE_PASSWORD"},
	}

	for _, ref := range refs {
		pw, err := c.fetchSecretKey(ctx, ref.ns, ref.name, ref.key)
		if err == nil && pw != "" {
			c.mu.Lock()
			c.cachedPass = pw
			c.warnedNoSec = false
			c.mu.Unlock()
			return pw
		}
	}

	c.mu.Lock()
	if !c.warnedNoSec {
		c.warnedNoSec = true
		log.Printf("[aigw-collector] No AI Gateway ClickHouse secret found in cluster (waiting quietly)")
	}
	c.mu.Unlock()
	return ""
}

func (c *Collector) fetchSecretKey(ctx context.Context, namespace, name, key string) (string, error) {
	u := fmt.Sprintf("%s/api/v1/namespaces/%s/secrets/%s", c.cfg.KubeAPIServer, namespace, name)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+c.kubeToken)

	resp, err := c.kubeClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("status %d", resp.StatusCode)
	}

	var sec struct {
		Data map[string]string `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&sec); err != nil {
		return "", err
	}
	b64, ok := sec.Data[key]
	if !ok || b64 == "" {
		return "", fmt.Errorf("key %q missing", key)
	}
	raw, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(raw)), nil
}

func (c *Collector) emitMockEvent() {
	ev := protocol.AIGatewayEvent{
		Timestamp:          time.Now().UnixMilli(),
		ClusterID:          c.cfg.ClusterID,
		ClientID:           "fx-arbitrage-agent",
		ModelName:          "claude-sonnet-4-5",
		RouteName:          "sovereign-wealth-apac",
		PromptTokens:       320,
		CompletionTokens:   180,
		TimeToFirstTokenMs: 145,
		TotalLatencyMs:     620,
		StatusCode:         200,
		CostUSD:            0.00366,
	}
	select {
	case c.eventsChan <- ev:
	default:
	}
}
