package main

import (
	"context"
	"flag"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/JLCode-tech/bnk-forge/pkg/ingest"
)

func main() {
	addr := flag.String("addr", getEnv("FORGE_INGEST_ADDR", ":17543"), "Address to listen on")
	chURL := flag.String("clickhouse-url", getEnv("CLICKHOUSE_URL", "http://localhost:8123"), "ClickHouse HTTP URL")
	chUser := flag.String("clickhouse-user", getEnv("CLICKHOUSE_USER", "default"), "ClickHouse User")
	chPassword := flag.String("clickhouse-password", getEnv("CLICKHOUSE_PASSWORD", "bnkforge_dev_password"), "ClickHouse Password")
	natsAddr := flag.String("nats-addr", getEnv("NATS_ADDR", "localhost:4222"), "NATS TCP address")
	backendURL := flag.String("backend-url", getEnv("BACKEND_URL", "http://localhost:8000"), "Backend URL for reverse proxying enrollment APIs")
	tlsCert := flag.String("tls-cert", os.Getenv("TLS_CERT_FILE"), "TLS certificate file path")
	tlsKey := flag.String("tls-key", os.Getenv("TLS_KEY_FILE"), "TLS private key file path")
	clientCA := flag.String("client-ca", os.Getenv("CLIENT_CA_FILE"), "Client CA file for mTLS")
	requireMTLS := flag.Bool("require-mtls", os.Getenv("REQUIRE_MTLS") == "true", "Require mTLS client certs")
	initSchema := flag.Bool("init-schema", true, "Initialize ClickHouse telemetry schema on startup")
	flag.Parse()

	log.Printf("[forge-ingest] Starting Ingest Gateway on %s", *addr)

	chWriter := ingest.NewClickHouseWriterWithAuth(*chURL, *chUser, *chPassword)
	if *initSchema {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		if err := chWriter.InitSchema(ctx); err != nil {
			log.Printf("[forge-ingest] Warning: ClickHouse schema init returned: %v (continuing)", err)
		} else {
			log.Printf("[forge-ingest] ClickHouse telemetry schema initialized successfully")
		}
		cancel()
	}

	natsPub := ingest.NewSimpleNATSPublisher(*natsAddr)

	cfg := ingest.ServerConfig{
		Addr:          *addr,
		ClickHouseURL: *chURL,
		NATSAddr:      *natsAddr,
		BackendURL:    *backendURL,
		TLSCertFile:   *tlsCert,
		TLSKeyFile:    *tlsKey,
		ClientCAFile:  *clientCA,
		RequireMTLS:   *requireMTLS,
		RingConfig:    ingest.DefaultRingBufferConfig(),
	}

	server := ingest.NewIngestServer(cfg, chWriter, natsPub)

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)

	go func() {
		if err := server.Start(); err != nil {
			log.Printf("[forge-ingest] Server terminated: %v", err)
		}
	}()

	sig := <-stop
	log.Printf("[forge-ingest] Received signal %v, initiating graceful shutdown...", sig)

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()

	if err := server.Shutdown(shutdownCtx); err != nil {
		log.Printf("[forge-ingest] Error during shutdown: %v", err)
	}

	_ = natsPub.Close()
	log.Printf("[forge-ingest] Shutdown complete.")
}

func getEnv(key, fallback string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return fallback
}
