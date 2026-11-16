package tasks

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"strings"
	"sync"
	"time"
)

const (
	// DefaultStreamName is the JetStream WorkQueue stream for background tasks.
	DefaultStreamName = "FORGE_TASKS"
	// DefaultSubjectPattern matches all task subjects.
	DefaultSubjectPattern = "forge.tasks.*"
	// DefaultSubjectPrefix is the prefix prepended to task names.
	DefaultSubjectPrefix = "forge.tasks."
	// DefaultConsumerName is the durable pull consumer name.
	DefaultConsumerName = "forge-worker"
)

// TaskMessage defines the standardized envelope for asynchronous background tasks.
type TaskMessage struct {
	TaskID    string                 `json:"task_id"`
	TaskName  string                 `json:"task_name"`
	Args      []interface{}          `json:"args,omitempty"`
	Kwargs    map[string]interface{} `json:"kwargs,omitempty"`
	CreatedAt int64                  `json:"created_at"`
	Retries   int                    `json:"retries,omitempty"`
}

// TaskHandler is a function that executes a task.
type TaskHandler func(ctx context.Context, task *TaskMessage) error

// StreamConfig describes the NATS JetStream stream creation payload.
type StreamConfig struct {
	Name      string   `json:"name"`
	Subjects  []string `json:"subjects"`
	Retention string   `json:"retention"` // "workqueue" or "limits"
	Storage   string   `json:"storage"`   // "file" or "memory"
	MaxAge    int64    `json:"max_age"`   // nanoseconds (e.g. 7 days = 604800000000000)
}

// WorkQueueManager coordinates publishing, consuming, and stream lifecycle for FORGE_TASKS.
type WorkQueueManager struct {
	natsAddr   string
	dialer     func(network, address string) (net.Conn, error)
	handlers   map[string]TaskHandler
	mu         sync.RWMutex
	conn       net.Conn
	streamName string
}

// Option configures the WorkQueueManager.
type Option func(*WorkQueueManager)

// WithDialer sets a custom net.Dialer (for hermetic testing).
func WithDialer(dialer func(network, address string) (net.Conn, error)) Option {
	return func(m *WorkQueueManager) {
		m.dialer = dialer
	}
}

// WithStreamName overrides the default stream name.
func WithStreamName(name string) Option {
	return func(m *WorkQueueManager) {
		m.streamName = name
	}
}

// NewWorkQueueManager constructs a new JetStream WorkQueue manager.
func NewWorkQueueManager(natsAddr string, opts ...Option) *WorkQueueManager {
	if natsAddr == "" {
		natsAddr = "localhost:4222"
	}
	m := &WorkQueueManager{
		natsAddr:   natsAddr,
		streamName: DefaultStreamName,
		handlers:   make(map[string]TaskHandler),
		dialer: func(network, address string) (net.Conn, error) {
			return net.DialTimeout(network, address, 2*time.Second)
		},
	}
	for _, opt := range opts {
		opt(m)
	}
	return m
}

// RegisterHandler registers an execution function for a specific task name.
func (m *WorkQueueManager) RegisterHandler(taskName string, handler TaskHandler) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.handlers[taskName] = handler
}

// GetHandler retrieves the registered handler for a task name.
func (m *WorkQueueManager) GetHandler(taskName string) (TaskHandler, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	h, ok := m.handlers[taskName]
	return h, ok
}

// BuildStreamConfig returns the declarative JetStream stream configuration.
func (m *WorkQueueManager) BuildStreamConfig() StreamConfig {
	return StreamConfig{
		Name:      m.streamName,
		Subjects:  []string{DefaultSubjectPattern},
		Retention: "workqueue",
		Storage:   "file",
		MaxAge:    int64(7 * 24 * time.Hour),
	}
}

func (m *WorkQueueManager) connect() error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.conn != nil {
		_ = m.conn.Close()
		m.conn = nil
	}

	conn, err := m.dialer("tcp", m.natsAddr)
	if err != nil {
		return fmt.Errorf("nats connection offline (%s): %w", m.natsAddr, err)
	}
	m.conn = conn

	// Send NATS CONNECT handshake
	connectMsg := []byte("CONNECT {\"verbose\":false,\"pedantic\":false,\"lang\":\"go\",\"version\":\"1.0.0\"}\r\n")
	_, err = m.conn.Write(connectMsg)
	return err
}

// EnsureStream sends the JetStream API request to create or update the FORGE_TASKS stream.
func (m *WorkQueueManager) EnsureStream(ctx context.Context) error {
	cfg := m.BuildStreamConfig()
	payload, err := json.Marshal(cfg)
	if err != nil {
		return fmt.Errorf("failed to marshal stream config: %w", err)
	}

	subject := fmt.Sprintf("$JS.API.STREAM.CREATE.%s", m.streamName)
	return m.publishRaw(ctx, subject, payload)
}

// PublishTask enqueues a TaskMessage to NATS JetStream on subject `forge.tasks.{task_name}`.
func (m *WorkQueueManager) PublishTask(ctx context.Context, task *TaskMessage) error {
	if task == nil {
		return fmt.Errorf("task cannot be nil")
	}
	if task.TaskID == "" {
		task.TaskID = fmt.Sprintf("task-%d", time.Now().UnixNano())
	}
	if task.CreatedAt == 0 {
		task.CreatedAt = time.Now().Unix()
	}

	payload, err := json.Marshal(task)
	if err != nil {
		return fmt.Errorf("failed to marshal task payload: %w", err)
	}

	subject := DefaultSubjectPrefix + cleanTaskName(task.TaskName)
	return m.publishRaw(ctx, subject, payload)
}

func (m *WorkQueueManager) publishRaw(ctx context.Context, subject string, data []byte) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.conn == nil {
		if err := m.connectLocked(); err != nil {
			return err
		}
	}

	pubHeader := fmt.Sprintf("PUB %s %d\r\n", subject, len(data))
	if _, err := m.conn.Write([]byte(pubHeader)); err != nil {
		_ = m.conn.Close()
		m.conn = nil
		return fmt.Errorf("nats write header failed: %w", err)
	}

	if _, err := m.conn.Write(append(data, []byte("\r\n")...)); err != nil {
		_ = m.conn.Close()
		m.conn = nil
		return fmt.Errorf("nats write payload failed: %w", err)
	}

	return nil
}

func (m *WorkQueueManager) connectLocked() error {
	conn, err := m.dialer("tcp", m.natsAddr)
	if err != nil {
		return fmt.Errorf("nats connection offline (%s): %w", m.natsAddr, err)
	}
	m.conn = conn

	connectMsg := []byte("CONNECT {\"verbose\":false,\"pedantic\":false,\"lang\":\"go\",\"version\":\"1.0.0\"}\r\n")
	_, err = m.conn.Write(connectMsg)
	return err
}

// ExecuteTask deserializes a task payload and invokes the registered handler.
func (m *WorkQueueManager) ExecuteTask(ctx context.Context, payload []byte) error {
	var task TaskMessage
	if err := json.Unmarshal(payload, &task); err != nil {
		return fmt.Errorf("invalid task message payload: %w", err)
	}

	handler, exists := m.GetHandler(task.TaskName)
	if !exists {
		// Try clean task name lookup
		handler, exists = m.GetHandler(cleanTaskName(task.TaskName))
	}

	if !exists {
		return fmt.Errorf("no handler registered for task: %s", task.TaskName)
	}

	return handler(ctx, &task)
}

// Close closes the NATS connection.
func (m *WorkQueueManager) Close() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.conn != nil {
		err := m.conn.Close()
		m.conn = nil
		return err
	}
	return nil
}

func cleanTaskName(name string) string {
	parts := strings.Split(name, ".")
	if len(parts) > 0 {
		return parts[len(parts)-1]
	}
	return name
}

// MockNATSConn provides an in-memory net.Conn for testing NATS wire interactions.
type MockNATSConn struct {
	net.Conn
	mu      sync.Mutex
	written []byte
	closed  bool
}

// NewMockNATSConn creates a new MockNATSConn.
func NewMockNATSConn() *MockNATSConn {
	return &MockNATSConn{written: make([]byte, 0)}
}

func (m *MockNATSConn) Write(b []byte) (n int, err error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed {
		return 0, fmt.Errorf("connection closed")
	}
	m.written = append(m.written, b...)
	return len(b), nil
}

func (m *MockNATSConn) Read(b []byte) (n int, err error) {
	return 0, nil
}

func (m *MockNATSConn) Close() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.closed = true
	return nil
}

// GetWritten returns the captured byte slice.
func (m *MockNATSConn) GetWritten() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return string(m.written)
}

// Scanner helper for reading protocol frames
func ScanLines(r *bufio.Reader) ([]string, error) {
	var lines []string
	for {
		line, err := r.ReadString('\n')
		if err != nil {
			break
		}
		lines = append(lines, strings.TrimRight(line, "\r\n"))
	}
	return lines, nil
}
