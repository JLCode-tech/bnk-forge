package main

import (
	"context"
	"flag"
	"log"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/JLCode-tech/bnk-forge/pkg/agent"
	"github.com/JLCode-tech/bnk-forge/pkg/agent/transport"
)

func main() {
	consoleURL := flag.String("console-url", getEnv("CONSOLE_URL", "https://console:17543"), "Console Ingest Gateway URL")
	enrollmentToken := flag.String("enrollment-token", getEnv("ENROLLMENT_TOKEN", ""), "Enrollment JWT Token")
	clusterName := flag.String("cluster-name", getEnv("CLUSTER_NAME", "default-cluster"), "Target cluster name")
	clusterID := flag.String("cluster-id", getEnv("CLUSTER_ID", ""), "Optional pre-existing cluster UUID")
	nodeName := flag.String("node-name", getEnv("NODE_NAME", defaultHostname()), "Kubernetes Node Name")
	certDir := flag.String("cert-dir", getEnv("CERT_DIR", "/var/lib/forge-agent/certs"), "Path to persist mTLS certificates")
	spoolDir := flag.String("spool-dir", getEnv("SPOOL_DIR", "/var/lib/forge-agent/spool"), "Path to disk WAL spool")
	heartbeatInterval := flag.Duration("heartbeat-interval", 15*time.Second, "Heartbeat ping interval")
	flushInterval := flag.Duration("flush-interval", 1*time.Second, "Telemetry batch flush interval")
	batchSize := flag.Int("batch-size", 500, "Maximum batch record capacity before flush")
	mockMode := flag.Bool("mock-mode", getEnv("MOCK_MODE", "false") == "true", "Enable synthetic mock telemetry")
	insecureSkipVerify := flag.Bool("insecure-skip-verify", getEnv("INSECURE_SKIP_VERIFY", "false") == "true", "Skip TLS CA verification (dev only)")
	transportMode := flag.String("transport", getEnv("FORGE_TRANSPORT", "http"), "Transport mode: http, nats, failover, mirror")
	natsURL := flag.String("nats-url", getEnv("NATS_URL", "localhost:4222"), "NATS JetStream Leaf Node URL")
	tmmGatewayIPs := flag.String("tmm-gateway-ips", getEnv("TMM_GATEWAY_IPS", ""), "Comma-separated BNK TMM Ingress IP addresses")
	enableLeaderElection := flag.Bool("enable-leader-election", getEnv("ENABLE_LEADER_ELECTION", "false") == "true", "Enable Kubernetes Lease Leader Election")
	leaseName := flag.String("lease-name", getEnv("LEASE_NAME", "forge-agent-leader"), "Kubernetes Lease resource name")
	leaseNamespace := flag.String("lease-namespace", getEnv("LEASE_NAMESPACE", "forge-system"), "Kubernetes Lease resource namespace")
	aigwClickHouseURL := flag.String("aigw-clickhouse-url", getEnv("AIGW_CLICKHOUSE_URL", ""), "AI Gateway ClickHouse HTTP URL")
	aigwClickHouseUser := flag.String("aigw-clickhouse-user", getEnv("AIGW_CLICKHOUSE_USER", "otel"), "AI Gateway ClickHouse username")
	aigwClickHousePassword := flag.String("aigw-clickhouse-password", getEnv("AIGW_CLICKHOUSE_PASSWORD", ""), "AI Gateway ClickHouse password")

	flag.Parse()

	log.Printf("[forge-agent] Initializing Forge Edge Agent v1.0.0-pov on node %s", *nodeName)

	var tmmIPs []string
	if *tmmGatewayIPs != "" {
		for _, ip := range strings.Split(*tmmGatewayIPs, ",") {
			trimmed := strings.TrimSpace(ip)
			if trimmed != "" {
				tmmIPs = append(tmmIPs, trimmed)
			}
		}
	}

	cfg := agent.Config{
		ConsoleURL:          *consoleURL,
		EnrollmentToken:     *enrollmentToken,
		ClusterName:         *clusterName,
		ClusterID:           *clusterID,
		NodeName:            *nodeName,
		CertDir:             *certDir,
		SpoolDir:            *spoolDir,
		HeartbeatInterval:   *heartbeatInterval,
		BatchSize:           *batchSize,
		FlushInterval:       *flushInterval,
		MockMode:            *mockMode,
		InsecureSkipVerify:  *insecureSkipVerify,
		TransportMode:       transport.DualTransportMode(*transportMode),
		NATSURL:             *natsURL,
		EnableLeaderElection:   *enableLeaderElection,
		LeaseName:              *leaseName,
		LeaseNamespace:         *leaseNamespace,
		AIGWClickHouseURL:      *aigwClickHouseURL,
		AIGWClickHouseUser:     *aigwClickHouseUser,
		AIGWClickHousePassword: *aigwClickHousePassword,
		TmmGatewayIPs:          tmmIPs,
		ProtectedNamespaces: []string{"default", "ai-inference", "f5-ai-gateway"},
		ProtectedPorts:      []uint16{8000, 8080, 50051},
	}

	ag := agent.NewAgent(cfg)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	if err := ag.Start(ctx); err != nil {
		log.Fatalf("[forge-agent] Fatal startup error: %v", err)
	}

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)

	sig := <-sigChan
	log.Printf("[forge-agent] Received termination signal %v, commencing graceful shutdown...", sig)

	cancel()
	if err := ag.Stop(); err != nil {
		log.Printf("[forge-agent] Warning during shutdown: %v", err)
	}

	log.Printf("[forge-agent] Agent shutdown complete.")
}

func getEnv(key, fallback string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return fallback
}

func defaultHostname() string {
	h, err := os.Hostname()
	if err != nil || h == "" {
		return "node-01"
	}
	return h
}
