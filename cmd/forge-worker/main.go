package main

import (
	"context"
	"flag"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/JLCode-tech/bnk-forge/pkg/tasks"
)

func getEnv(key, defaultVal string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return defaultVal
}

func main() {
	natsAddr := flag.String("nats-addr", getEnv("NATS_ADDR", "localhost:4222"), "NATS JetStream server TCP address")
	streamName := flag.String("stream-name", getEnv("STREAM_NAME", tasks.DefaultStreamName), "NATS JetStream WorkQueue stream name")
	flag.Parse()

	log.Printf("[forge-worker] starting NATS JetStream worker (stream=%s, nats=%s)", *streamName, *natsAddr)

	mgr := tasks.NewWorkQueueManager(*natsAddr, tasks.WithStreamName(*streamName))
	tasks.RegisterStandardHandlers(mgr)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Ensure FORGE_TASKS stream exists on JetStream
	if err := mgr.EnsureStream(ctx); err != nil {
		log.Printf("[forge-worker] warning: ensure stream returned %v (NATS may be offline or starting)", err)
	} else {
		log.Printf("[forge-worker] verified JetStream WorkQueue stream %s exists", *streamName)
	}

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	log.Printf("[forge-worker] worker ready and listening for tasks on %s.*", tasks.DefaultSubjectPrefix)

	for {
		select {
		case sig := <-sigCh:
			log.Printf("[forge-worker] received signal %v, shutting down...", sig)
			_ = mgr.Close()
			return
		case <-ticker.C:
			// Routine keepalive / health ping
			_ = mgr.EnsureStream(ctx)
		}
	}
}
