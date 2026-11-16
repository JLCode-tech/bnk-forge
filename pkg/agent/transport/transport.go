package transport

import (
	"context"

	"github.com/JLCode-tech/bnk-forge/pkg/protocol"
)

// Transport defines the communication contract between the edge agent and Ingest Gateway.
type Transport interface {
	// StreamBatch transmits a batch of telemetry records to the Ingest Gateway.
	StreamBatch(ctx context.Context, batch *protocol.TelemetryBatch) error

	// Register performs the initial handshake to announce presence and receive configuration.
	Register(ctx context.Context, req *protocol.RegisterRequest) (*protocol.RegisterResponse, error)

	// SendHeartbeat sends an uptime/liveness ping and receives acknowledgment.
	SendHeartbeat(ctx context.Context, ping *protocol.Ping) (*protocol.Pong, error)

	// Ping checks if the Ingest Gateway healthz endpoint is reachable.
	Ping(ctx context.Context) error

	// Close cleanly terminates the transport connection.
	Close() error
}
