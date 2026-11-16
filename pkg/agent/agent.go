package agent

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"sync"
	"sync/atomic"
	"time"

	"github.com/JLCode-tech/bnk-forge/pkg/agent/bootstrap"
	"github.com/JLCode-tech/bnk-forge/pkg/agent/ebpf"
	"github.com/JLCode-tech/bnk-forge/pkg/agent/tmm"
	"github.com/JLCode-tech/bnk-forge/pkg/agent/transport"
	"github.com/JLCode-tech/bnk-forge/pkg/protocol"
)

// Config configures the core Forge Agent daemon.
type Config struct {
	ConsoleURL          string
	EnrollmentToken     string
	ClusterName         string
	ClusterID           string
	NodeName            string
	CertDir             string
	SpoolDir            string
	HeartbeatInterval   time.Duration
	BatchSize           int
	FlushInterval       time.Duration
	MockMode            bool
	InsecureSkipVerify  bool
	RoundTripper        http.RoundTripper
	TmmGatewayIPs       []string
	ProtectedNamespaces       []string
	ProtectedPorts            []uint16
	SyntheticEmissionInterval time.Duration
}

// Agent coordinates bootstrap, local eBPF / TMM collectors, and resilient outbound transport.
type Agent struct {
	cfg       Config
	creds     *bootstrap.BootstrapCredentials
	transport *transport.SpoolingTransport
	spool     transport.DiskSpool
	observer  ebpf.Observer
	harvester tmm.Harvester

	agentID      string
	sessionToken string
	startTime    time.Time
	batchSeq     uint64

	mu          sync.Mutex
	running     bool
	stopChan    chan struct{}
	doneChan    chan struct{}
	curBatch    *protocol.TelemetryBatch
	lastFlush   time.Time
	batchNotify chan struct{}
}

// NewAgent constructs a new Forge Agent instance.
func NewAgent(cfg Config) *Agent {
	if cfg.ConsoleURL == "" {
		cfg.ConsoleURL = "https://console:17543"
	}
	if cfg.NodeName == "" {
		hostname, _ := os.Hostname()
		if hostname != "" {
			cfg.NodeName = hostname
		} else {
			cfg.NodeName = "node-01"
		}
	}
	if cfg.ClusterName == "" {
		cfg.ClusterName = "local-cluster"
	}
	if cfg.HeartbeatInterval <= 0 {
		cfg.HeartbeatInterval = 15 * time.Second
	}
	if cfg.BatchSize <= 0 {
		cfg.BatchSize = 500
	}
	if cfg.FlushInterval <= 0 {
		cfg.FlushInterval = 1 * time.Second
	}

	return &Agent{
		cfg:         cfg,
		startTime:   time.Now(),
		stopChan:    make(chan struct{}),
		doneChan:    make(chan struct{}),
		batchNotify: make(chan struct{}, 1),
	}
}

// Start boots the agent, completes bootstrap, establishes transport, and begins telemetry streaming.
func (a *Agent) Start(ctx context.Context) error {
	a.mu.Lock()
	if a.running {
		a.mu.Unlock()
		return nil
	}
	a.running = true
	a.mu.Unlock()

	log.Printf("[Forge-Agent] Starting agent on node '%s' (cluster: '%s')", a.cfg.NodeName, a.cfg.ClusterName)

	// 1. Bootstrap mTLS Identity
	if err := a.initIdentity(ctx); err != nil {
		return fmt.Errorf("agent identity bootstrap failed: %w", err)
	}

	// 2. Initialize Transport and Spool
	if err := a.initTransport(); err != nil {
		return fmt.Errorf("agent transport initialization failed: %w", err)
	}

	// 3. Register Agent with Ingest Gateway
	if err := a.register(ctx); err != nil {
		log.Printf("[Forge-Agent] Initial registration warning: %v (continuing)", err)
	}

	// 4. Initialize Collectors
	a.initCollectors()

	// Start Observer & Harvester
	if err := a.observer.Start(ctx); err != nil {
		return fmt.Errorf("starting eBPF observer: %w", err)
	}
	if err := a.harvester.Start(ctx); err != nil {
		return fmt.Errorf("starting TMM harvester: %w", err)
	}

	// 5. Start Background Loops
	go a.runAggregationLoop(ctx)
	go a.runHeartbeatLoop(ctx)

	log.Printf("[Forge-Agent] Agent operational (AgentID: %s, SPIFFE: %s)", a.agentID, a.creds.SPIFFEID)
	return nil
}

func (a *Agent) initIdentity(ctx context.Context) error {
	bootClient := bootstrap.NewClient(bootstrap.Config{
		ConsoleURL:         a.cfg.ConsoleURL,
		EnrollmentToken:    a.cfg.EnrollmentToken,
		ClusterName:        a.cfg.ClusterName,
		ClusterUUID:        a.cfg.ClusterID,
		NodeName:           a.cfg.NodeName,
		CertDir:            a.cfg.CertDir,
		InsecureSkipVerify: a.cfg.InsecureSkipVerify,
		RoundTripper:       a.cfg.RoundTripper,
	})

	creds, err := bootClient.Bootstrap(ctx)
	if err != nil {
		// If certDir was not provided and no token, generate local dev identity
		if a.cfg.CertDir == "" && a.cfg.EnrollmentToken == "" {
			clusterID := a.cfg.ClusterID
			if clusterID == "" {
				clusterID = "dev-cluster-local"
			}
			a.creds = &bootstrap.BootstrapCredentials{
				ClusterUUID: clusterID,
				NodeName:    a.cfg.NodeName,
				SPIFFEID:    fmt.Sprintf("spiffe://forge/cluster/%s", clusterID),
				ExpiresAt:   time.Now().Add(30 * 24 * time.Hour),
			}
			if a.cfg.ClusterID == "" {
				a.cfg.ClusterID = clusterID
			}
			return nil
		}
		return err
	}

	a.creds = creds
	if a.cfg.ClusterID == "" && creds.ClusterUUID != "" {
		a.cfg.ClusterID = creds.ClusterUUID
	}
	return nil
}

func (a *Agent) initTransport() error {
	var diskSpool transport.DiskSpool
	var err error

	if a.cfg.SpoolDir != "" {
		diskSpool, err = transport.NewFileDiskSpool(transport.SpoolConfig{
			SpoolDir:     a.cfg.SpoolDir,
			MaxSizeBytes: transport.DefaultMaxSpoolSize,
		})
		if err != nil {
			return fmt.Errorf("initializing spool: %w", err)
		}
	} else {
		tempDir, _ := os.MkdirTemp("", "agent-spool-*")
		diskSpool, err = transport.NewFileDiskSpool(transport.SpoolConfig{
			SpoolDir:     tempDir,
			MaxSizeBytes: 50 * 1024 * 1024,
		})
		if err != nil {
			return err
		}
	}
	a.spool = diskSpool

	httpTr, err := transport.NewHTTPTransport(transport.HTTPTransportConfig{
		BaseURL:            a.cfg.ConsoleURL,
		TLSCertData:        a.creds.CertPEM,
		TLSKeyData:         a.creds.KeyPEM,
		CACertData:         a.creds.CAPEM,
		InsecureSkipVerify: a.cfg.InsecureSkipVerify,
		RoundTripper:       a.cfg.RoundTripper,
		Timeout:            10 * time.Second,
	})
	if err != nil {
		return fmt.Errorf("creating http transport: %w", err)
	}

	a.transport = transport.NewSpoolingTransport(httpTr, a.spool)
	return nil
}

func (a *Agent) initCollectors() {
	emissionInterval := a.cfg.SyntheticEmissionInterval
	if emissionInterval <= 0 {
		emissionInterval = a.cfg.FlushInterval
	}
	if emissionInterval <= 0 {
		emissionInterval = 500 * time.Millisecond
	}

	a.observer = ebpf.NewSocketObserver(ebpf.Config{
		ClusterID:                 a.cfg.ClusterID,
		NodeName:                  a.cfg.NodeName,
		TmmGatewayIPs:             a.cfg.TmmGatewayIPs,
		ProtectedNamespaces:       a.cfg.ProtectedNamespaces,
		ProtectedPorts:            a.cfg.ProtectedPorts,
		MockMode:                  a.cfg.MockMode,
		SyntheticEmissionInterval: emissionInterval,
	})

	a.harvester = tmm.NewDPDKHarvester(tmm.Config{
		ClusterID: a.cfg.ClusterID,
		NodeName:  a.cfg.NodeName,
		MockMode:  a.cfg.MockMode,
	})
}

func (a *Agent) register(ctx context.Context) error {
	req := &protocol.RegisterRequest{
		ClusterID:    a.cfg.ClusterID,
		ClusterName:  a.cfg.ClusterName,
		AgentVersion: "1.0.0-pov",
		NodeName:     a.cfg.NodeName,
		Capabilities: []string{"ebpf-socket", "tmm-dpdk", "wal-spool"},
	}

	resp, err := a.transport.Register(ctx, req)
	if err != nil {
		a.agentID = fmt.Sprintf("agent-%s-%s", a.cfg.ClusterID, a.cfg.NodeName)
		return err
	}

	a.agentID = resp.AgentID
	a.sessionToken = resp.SessionToken
	if resp.HeartbeatIntervalSec > 0 {
		a.cfg.HeartbeatInterval = time.Duration(resp.HeartbeatIntervalSec) * time.Second
	}
	return nil
}

func (a *Agent) runHeartbeatLoop(ctx context.Context) {
	ticker := time.NewTicker(a.cfg.HeartbeatInterval)
	defer ticker.Stop()

	// Send initial heartbeat immediately on startup
	a.sendHeartbeat(ctx)

	for {
		select {
		case <-ctx.Done():
			return
		case <-a.stopChan:
			return
		case <-ticker.C:
			a.sendHeartbeat(ctx)
		}
	}
}

func (a *Agent) sendHeartbeat(ctx context.Context) {
	ping := &protocol.Ping{
		ClusterID:     a.cfg.ClusterID,
		AgentID:       a.agentID,
		Timestamp:     time.Now().Unix(),
		Status:        "HEALTHY",
		UptimeSeconds: uint64(time.Since(a.startTime).Seconds()),
	}

	hbCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	_, _ = a.transport.SendHeartbeat(hbCtx, ping)
}

func (a *Agent) runAggregationLoop(ctx context.Context) {
	defer close(a.doneChan)

	flushTicker := time.NewTicker(a.cfg.FlushInterval)
	defer flushTicker.Stop()

	a.curBatch = a.newBatch()
	a.lastFlush = time.Now()

	for {
		select {
		case <-ctx.Done():
			a.flushCurrentBatch()
			return
		case <-a.stopChan:
			a.flushCurrentBatch()
			return
		case flow, ok := <-a.observer.Flows():
			if ok {
				a.curBatch.Flows = append(a.curBatch.Flows, flow)
				if len(a.curBatch.Flows)+len(a.curBatch.Metrics) >= a.cfg.BatchSize {
					a.flushCurrentBatch()
				}
			}
		case metric, ok := <-a.harvester.Metrics():
			if ok {
				a.curBatch.Metrics = append(a.curBatch.Metrics, metric)
				if len(a.curBatch.Flows)+len(a.curBatch.Metrics) >= a.cfg.BatchSize {
					a.flushCurrentBatch()
				}
			}
		case <-flushTicker.C:
			if len(a.curBatch.Flows) > 0 || len(a.curBatch.Metrics) > 0 {
				a.flushCurrentBatch()
			}
		}
	}
}

func (a *Agent) newBatch() *protocol.TelemetryBatch {
	seq := atomic.AddUint64(&a.batchSeq, 1)
	return &protocol.TelemetryBatch{
		BatchID:   fmt.Sprintf("batch-%s-%d-%d", a.cfg.NodeName, time.Now().Unix(), seq),
		ClusterID: a.cfg.ClusterID,
		NodeName:  a.cfg.NodeName,
		SentAt:    time.Now().UnixNano(),
		Flows:     make([]protocol.EBPFSocketFlow, 0, a.cfg.BatchSize),
		Metrics:   make([]protocol.TMMDPDKMetric, 0, 100),
	}
}

func (a *Agent) flushCurrentBatch() {
	if len(a.curBatch.Flows) == 0 && len(a.curBatch.Metrics) == 0 {
		return
	}

	batchToFlush := a.curBatch
	a.curBatch = a.newBatch()
	a.lastFlush = time.Now()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := a.transport.StreamBatch(ctx, batchToFlush); err != nil {
		log.Printf("[Forge-Agent] Batch flush error: %v", err)
	}
}

// Stop cleanly terminates collectors, flushes remaining batches, and closes transport.
func (a *Agent) Stop() error {
	a.mu.Lock()
	if !a.running {
		a.mu.Unlock()
		return nil
	}
	a.running = false
	a.mu.Unlock()

	log.Printf("[Forge-Agent] Shutting down agent...")
	close(a.stopChan)
	<-a.doneChan

	_ = a.observer.Stop()
	_ = a.harvester.Stop()

	return a.transport.Close()
}
