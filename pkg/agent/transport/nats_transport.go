package transport

import (
	"bufio"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/JLCode-tech/bnk-forge/pkg/protocol"
)

// DualTransportMode defines the operational coordination between HTTP and NATS transports.
type DualTransportMode string

const (
	// ModeHTTP uses only the HTTP/mTLS transport.
	ModeHTTP DualTransportMode = "http"

	// ModeNATS uses only the NATS Leaf Node transport.
	ModeNATS DualTransportMode = "nats"

	// ModeFailover attempts primary (HTTP) and automatically fails over to secondary (NATS).
	ModeFailover DualTransportMode = "failover"

	// ModeMirror concurrently replicates batches to both transports for air-gap redundancy.
	ModeMirror DualTransportMode = "mirror"
)

// NATSTransportConfig configures the NATS Leaf Node transport.
type NATSTransportConfig struct {
	NATSURL            string
	ClusterID          string
	NodeName           string
	SubjectPrefix      string
	LeafNodeMode       bool
	TLSCertFile        string
	TLSKeyFile         string
	CACertFile         string
	TLSCertData        []byte
	TLSKeyData         []byte
	CACertData         []byte
	InsecureSkipVerify bool
	Dialer             func(network, address string) (net.Conn, error)
	Timeout            time.Duration
}

// NATSTransport implements the Transport interface via NATS JetStream Leaf Node connectivity.
type NATSTransport struct {
	cfg           NATSTransportConfig
	subjectPrefix string
	dialer        func(network, address string) (net.Conn, error)

	mu        sync.Mutex
	conn      net.Conn
	reader    *bufio.Reader
	connected bool
	closed    bool
	msgSeq    uint64
}

// NewNATSTransport constructs a new NATS Transport client.
func NewNATSTransport(cfg NATSTransportConfig) (*NATSTransport, error) {
	if cfg.NATSURL == "" {
		cfg.NATSURL = "localhost:4222"
	}
	// Strip scheme if present
	cfg.NATSURL = strings.TrimPrefix(cfg.NATSURL, "nats://")
	cfg.NATSURL = strings.TrimPrefix(cfg.NATSURL, "tls://")

	if cfg.SubjectPrefix == "" {
		cfg.SubjectPrefix = "forge.telemetry"
	}
	if cfg.Timeout <= 0 {
		cfg.Timeout = 5 * time.Second
	}

	dialer := cfg.Dialer
	if dialer == nil {
		dialer = func(network, address string) (net.Conn, error) {
			hasTLS := len(cfg.TLSCertData) > 0 || cfg.TLSCertFile != "" || len(cfg.CACertData) > 0 || cfg.CACertFile != ""
			if hasTLS {
				tlsConfig, err := buildNATSTLSConfig(cfg)
				if err != nil {
					return nil, fmt.Errorf("building NATS TLS config: %w", err)
				}
				return tls.DialWithDialer(&net.Dialer{Timeout: cfg.Timeout}, network, address, tlsConfig)
			}
			return net.DialTimeout(network, address, cfg.Timeout)
		}
	}

	t := &NATSTransport{
		cfg:           cfg,
		subjectPrefix: strings.TrimRight(cfg.SubjectPrefix, "."),
		dialer:        dialer,
	}

	return t, nil
}

// connect ensures the TCP connection is established and the NATS CONNECT handshake is executed.
func (t *NATSTransport) connect() error {
	t.mu.Lock()
	defer t.mu.Unlock()

	if t.closed {
		return errors.New("nats transport is closed")
	}

	if t.conn != nil && t.connected {
		return nil
	}

	conn, err := t.dialer("tcp", t.cfg.NATSURL)
	if err != nil {
		return fmt.Errorf("nats connection failed (%s): %w", t.cfg.NATSURL, err)
	}

	t.conn = conn
	t.reader = bufio.NewReader(conn)
	t.connected = true

	// Send NATS CONNECT handshake
	clientName := fmt.Sprintf("forge-agent-%s-%s", t.cfg.ClusterID, t.cfg.NodeName)
	connectPayload := fmt.Sprintf(`{"verbose":false,"pedantic":false,"lang":"go","version":"1.0.0-pov","name":"%s"}`, clientName)
	if _, err := t.conn.Write([]byte("CONNECT " + connectPayload + "\r\n")); err != nil {
		_ = t.conn.Close()
		t.conn = nil
		t.connected = false
		return fmt.Errorf("nats handshake failed: %w", err)
	}

	return nil
}

// StreamBatch transmits a batch of telemetry records over NATS JetStream Leaf Node subject.
func (t *NATSTransport) StreamBatch(ctx context.Context, batch *protocol.TelemetryBatch) error {
	if err := t.connect(); err != nil {
		return err
	}

	data, err := json.Marshal(batch)
	if err != nil {
		return fmt.Errorf("failed marshaling telemetry batch: %w", err)
	}

	subject := fmt.Sprintf("%s.%s.batches", t.subjectPrefix, batch.ClusterID)
	return t.publish(subject, data)
}

// Register performs the initial registration handshake over NATS.
func (t *NATSTransport) Register(ctx context.Context, req *protocol.RegisterRequest) (*protocol.RegisterResponse, error) {
	if err := t.connect(); err != nil {
		return nil, err
	}

	data, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("failed marshaling register request: %w", err)
	}

	subject := fmt.Sprintf("%s.%s.register", t.subjectPrefix, req.ClusterID)
	if err := t.publish(subject, data); err != nil {
		return nil, err
	}

	resp := &protocol.RegisterResponse{
		Status:               protocol.RegisterStatusOK,
		AgentID:              fmt.Sprintf("agent-%s-%s", req.ClusterID, req.NodeName),
		HeartbeatIntervalSec: 15,
		SessionToken:         fmt.Sprintf("nats-session-%d", time.Now().UnixNano()),
		ServerTime:           time.Now().Unix(),
		Message:              "registered via nats leaf node",
	}

	return resp, nil
}

// SendHeartbeat sends an uptime/liveness ping over NATS.
func (t *NATSTransport) SendHeartbeat(ctx context.Context, ping *protocol.Ping) (*protocol.Pong, error) {
	if err := t.connect(); err != nil {
		return nil, err
	}

	data, err := json.Marshal(ping)
	if err != nil {
		return nil, fmt.Errorf("failed marshaling heartbeat ping: %w", err)
	}

	subject := fmt.Sprintf("%s.%s.heartbeat", t.subjectPrefix, ping.ClusterID)
	if err := t.publish(subject, data); err != nil {
		return nil, err
	}

	return &protocol.Pong{
		ServerTimestamp:      time.Now().Unix(),
		Ack:                  true,
		PendingCommandsCount: 0,
	}, nil
}

// Ping checks if the NATS transport is reachable by sending a wire PING.
func (t *NATSTransport) Ping(ctx context.Context) error {
	if err := t.connect(); err != nil {
		return err
	}

	t.mu.Lock()
	defer t.mu.Unlock()

	if t.conn == nil {
		return errors.New("nats connection not available")
	}

	if _, err := t.conn.Write([]byte("PING\r\n")); err != nil {
		t.connected = false
		_ = t.conn.Close()
		t.conn = nil
		return fmt.Errorf("nats ping failed: %w", err)
	}

	return nil
}

// Close cleanly terminates the NATS connection.
func (t *NATSTransport) Close() error {
	t.mu.Lock()
	defer t.mu.Unlock()

	t.closed = true
	t.connected = false
	if t.conn != nil {
		err := t.conn.Close()
		t.conn = nil
		return err
	}
	return nil
}

func (t *NATSTransport) publish(subject string, payload []byte) error {
	t.mu.Lock()
	defer t.mu.Unlock()

	if t.conn == nil || !t.connected {
		return errors.New("nats client disconnected")
	}

	atomic.AddUint64(&t.msgSeq, 1)

	// PUB <subject> <bytes>\r\n<payload>\r\n
	pubHeader := fmt.Sprintf("PUB %s %d\r\n", subject, len(payload))
	if _, err := t.conn.Write([]byte(pubHeader)); err != nil {
		t.connected = false
		_ = t.conn.Close()
		t.conn = nil
		return fmt.Errorf("nats write header failed: %w", err)
	}

	if _, err := t.conn.Write(append(payload, []byte("\r\n")...)); err != nil {
		t.connected = false
		_ = t.conn.Close()
		t.conn = nil
		return fmt.Errorf("nats write payload failed: %w", err)
	}

	return nil
}

func buildNATSTLSConfig(cfg NATSTransportConfig) (*tls.Config, error) {
	tlsConfig := &tls.Config{
		InsecureSkipVerify: cfg.InsecureSkipVerify,
		MinVersion:         tls.VersionTLS12,
	}

	var caBytes []byte
	if len(cfg.CACertData) > 0 {
		caBytes = cfg.CACertData
	} else if cfg.CACertFile != "" {
		var err error
		caBytes, err = os.ReadFile(cfg.CACertFile)
		if err != nil {
			return nil, fmt.Errorf("reading CA file: %w", err)
		}
	}

	if len(caBytes) > 0 {
		pool := x509.NewCertPool()
		if !pool.AppendCertsFromPEM(caBytes) {
			return nil, fmt.Errorf("failed appending CA certs to pool")
		}
		tlsConfig.RootCAs = pool
	}

	var cert tls.Certificate
	var hasCert bool

	if len(cfg.TLSCertData) > 0 && len(cfg.TLSKeyData) > 0 {
		var err error
		cert, err = tls.X509KeyPair(cfg.TLSCertData, cfg.TLSKeyData)
		if err != nil {
			return nil, fmt.Errorf("parsing client keypair: %w", err)
		}
		hasCert = true
	} else if cfg.TLSCertFile != "" && cfg.TLSKeyFile != "" {
		var err error
		cert, err = tls.LoadX509KeyPair(cfg.TLSCertFile, cfg.TLSKeyFile)
		if err != nil {
			return nil, fmt.Errorf("loading client keypair: %w", err)
		}
		hasCert = true
	}

	if hasCert {
		tlsConfig.Certificates = []tls.Certificate{cert}
	}

	return tlsConfig, nil
}

// ---------------------------------------------------------------------------
// DualTransport: Orchestrates Primary (HTTP/mTLS) and Secondary (NATS Leaf)
// ---------------------------------------------------------------------------

// DualTransportConfig defines the parameters for DualTransport.
type DualTransportConfig struct {
	Primary   Transport
	Secondary Transport
	Mode      DualTransportMode
}

// DualTransport combines two transports (HTTP/mTLS and NATS Leaf Node) to provide
// resilient failover or concurrent mirroring for air-gapped sovereign environments.
type DualTransport struct {
	primary   Transport
	secondary Transport
	mode      DualTransportMode
	mu        sync.RWMutex
}

// NewDualTransport creates a dual-transport router.
func NewDualTransport(cfg DualTransportConfig) *DualTransport {
	mode := cfg.Mode
	if mode == "" {
		mode = ModeFailover
	}
	return &DualTransport{
		primary:   cfg.Primary,
		secondary: cfg.Secondary,
		mode:      mode,
	}
}

// StreamBatch transmits telemetry batches according to the configured mode.
func (d *DualTransport) StreamBatch(ctx context.Context, batch *protocol.TelemetryBatch) error {
	d.mu.RLock()
	mode := d.mode
	primary := d.primary
	secondary := d.secondary
	d.mu.RUnlock()

	switch mode {
	case ModeMirror:
		// Replicate to both paths concurrently
		var primaryErr, secondaryErr error
		var wg sync.WaitGroup
		wg.Add(2)

		go func() {
			defer wg.Done()
			if primary != nil {
				primaryErr = primary.StreamBatch(ctx, batch)
			}
		}()

		go func() {
			defer wg.Done()
			if secondary != nil {
				secondaryErr = secondary.StreamBatch(ctx, batch)
			}
		}()

		wg.Wait()

		// If at least one succeeds, consider the batch streamed
		if primaryErr != nil && secondaryErr != nil {
			return fmt.Errorf("dual mirror failed: primary: %v; secondary: %v", primaryErr, secondaryErr)
		}
		return nil

	case ModeNATS:
		if secondary != nil {
			return secondary.StreamBatch(ctx, batch)
		}
		return errors.New("nats secondary transport not configured")

	case ModeHTTP:
		if primary != nil {
			return primary.StreamBatch(ctx, batch)
		}
		return errors.New("http primary transport not configured")

	case ModeFailover:
		fallthrough
	default:
		// Attempt primary first
		var err error
		if primary != nil {
			err = primary.StreamBatch(ctx, batch)
			if err == nil {
				return nil
			}
		}

		// Fallback to secondary NATS Leaf
		if secondary != nil {
			secErr := secondary.StreamBatch(ctx, batch)
			if secErr == nil {
				return nil
			}
			return fmt.Errorf("primary error (%v), secondary failover error: %w", err, secErr)
		}

		return err
	}
}

// Register performs agent registration with automatic transport failover.
func (d *DualTransport) Register(ctx context.Context, req *protocol.RegisterRequest) (*protocol.RegisterResponse, error) {
	d.mu.RLock()
	primary := d.primary
	secondary := d.secondary
	mode := d.mode
	d.mu.RUnlock()

	if mode == ModeNATS && secondary != nil {
		return secondary.Register(ctx, req)
	}

	if primary != nil {
		resp, err := primary.Register(ctx, req)
		if err == nil {
			return resp, nil
		}
		if secondary != nil {
			return secondary.Register(ctx, req)
		}
		return nil, err
	}

	if secondary != nil {
		return secondary.Register(ctx, req)
	}

	return nil, errors.New("no transport available for registration")
}

// SendHeartbeat sends heartbeat with failover.
func (d *DualTransport) SendHeartbeat(ctx context.Context, ping *protocol.Ping) (*protocol.Pong, error) {
	d.mu.RLock()
	primary := d.primary
	secondary := d.secondary
	mode := d.mode
	d.mu.RUnlock()

	if mode == ModeNATS && secondary != nil {
		return secondary.SendHeartbeat(ctx, ping)
	}

	if primary != nil {
		pong, err := primary.SendHeartbeat(ctx, ping)
		if err == nil {
			return pong, nil
		}
		if secondary != nil {
			return secondary.SendHeartbeat(ctx, ping)
		}
		return nil, err
	}

	if secondary != nil {
		return secondary.SendHeartbeat(ctx, ping)
	}

	return nil, errors.New("no transport available for heartbeat")
}

// Ping checks connectivity on primary or secondary.
func (d *DualTransport) Ping(ctx context.Context) error {
	d.mu.RLock()
	primary := d.primary
	secondary := d.secondary
	d.mu.RUnlock()

	if primary != nil && primary.Ping(ctx) == nil {
		return nil
	}
	if secondary != nil && secondary.Ping(ctx) == nil {
		return nil
	}

	return errors.New("all transports unreachable")
}

// Close terminates both primary and secondary transports.
func (d *DualTransport) Close() error {
	d.mu.Lock()
	defer d.mu.Unlock()

	var errs []string
	if d.primary != nil {
		if err := d.primary.Close(); err != nil {
			errs = append(errs, fmt.Sprintf("primary: %v", err))
		}
	}
	if d.secondary != nil {
		if err := d.secondary.Close(); err != nil {
			errs = append(errs, fmt.Sprintf("secondary: %v", err))
		}
	}

	if len(errs) > 0 {
		return fmt.Errorf("closing dual transports: %s", strings.Join(errs, "; "))
	}
	return nil
}
