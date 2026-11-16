package tasks

import (
	"context"
	"encoding/json"
	"net"
	"strings"
	"testing"
	"time"
)

func TestWorkQueueStreamConfig(t *testing.T) {
	mgr := NewWorkQueueManager("localhost:4222", WithStreamName("FORGE_TASKS"))
	cfg := mgr.BuildStreamConfig()

	if cfg.Name != "FORGE_TASKS" {
		t.Errorf("expected stream name FORGE_TASKS, got %s", cfg.Name)
	}
	if cfg.Retention != "workqueue" {
		t.Errorf("expected retention workqueue, got %s", cfg.Retention)
	}
	if len(cfg.Subjects) != 1 || cfg.Subjects[0] != "forge.tasks.*" {
		t.Errorf("expected subject pattern forge.tasks.*, got %v", cfg.Subjects)
	}
}

func TestWorkQueuePublishTask(t *testing.T) {
	mockConn := NewMockNATSConn()
	mgr := NewWorkQueueManager("localhost:4222", WithDialer(func(network, address string) (net.Conn, error) {
		return mockConn, nil
	}))

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	task := &TaskMessage{
		TaskID:   "test-uuid-1234",
		TaskName: "cluster_scan",
		Kwargs: map[string]interface{}{
			"cluster_id": 42,
		},
	}

	err := mgr.PublishTask(ctx, task)
	if err != nil {
		t.Fatalf("PublishTask failed: %v", err)
	}

	written := mockConn.GetWritten()
	if !strings.Contains(written, "CONNECT {") {
		t.Errorf("expected CONNECT in written data, got: %s", written)
	}
	if !strings.Contains(written, "PUB forge.tasks.cluster_scan") {
		t.Errorf("expected PUB forge.tasks.cluster_scan in written data, got: %s", written)
	}
	if !strings.Contains(written, "test-uuid-1234") {
		t.Errorf("expected task_id in payload, got: %s", written)
	}
}

func TestWorkQueueEnsureStream(t *testing.T) {
	mockConn := NewMockNATSConn()
	mgr := NewWorkQueueManager("localhost:4222", WithDialer(func(network, address string) (net.Conn, error) {
		return mockConn, nil
	}))

	ctx := context.Background()
	err := mgr.EnsureStream(ctx)
	if err != nil {
		t.Fatalf("EnsureStream failed: %v", err)
	}

	written := mockConn.GetWritten()
	if !strings.Contains(written, "PUB $JS.API.STREAM.CREATE.FORGE_TASKS") {
		t.Errorf("expected $JS.API.STREAM.CREATE.FORGE_TASKS in written, got: %s", written)
	}
	if !strings.Contains(written, `"retention":"workqueue"`) {
		t.Errorf("expected retention workqueue in written, got: %s", written)
	}
}

func TestWorkQueueHandlerExecution(t *testing.T) {
	mgr := NewWorkQueueManager("localhost:4222")

	invoked := false
	var passedID interface{}

	mgr.RegisterHandler("test_task", func(ctx context.Context, task *TaskMessage) error {
		invoked = true
		passedID = task.Kwargs["cluster_id"]
		return nil
	})

	payload, _ := json.Marshal(TaskMessage{
		TaskID:   "task-99",
		TaskName: "test_task",
		Kwargs: map[string]interface{}{
			"cluster_id": 999,
		},
	})

	err := mgr.ExecuteTask(context.Background(), payload)
	if err != nil {
		t.Fatalf("ExecuteTask failed: %v", err)
	}

	if !invoked {
		t.Errorf("expected handler to be invoked")
	}
	// json unmarshals numbers to float64
	if passedID != float64(999) {
		t.Errorf("expected cluster_id 999, got %v", passedID)
	}
}

func TestStandardHandlersRegistration(t *testing.T) {
	mgr := NewWorkQueueManager("localhost:4222")
	RegisterStandardHandlers(mgr)

	tasksToTest := []string{
		TaskClusterScan,
		"tasks.cluster_scan.scan_cluster_async",
		TaskHealthMonitor,
		TaskReconcileConfig,
		TaskDriftCheck,
		TaskOperatorCleanup,
	}

	for _, name := range tasksToTest {
		handler, exists := mgr.GetHandler(name)
		if !exists || handler == nil {
			t.Errorf("handler for %s not registered", name)
		}
	}

	// Verify executing cluster_scan
	payload, _ := json.Marshal(TaskMessage{
		TaskID:   "test-scan-1",
		TaskName: TaskClusterScan,
		Kwargs: map[string]interface{}{
			"cluster_id": 1,
		},
	})

	if err := mgr.ExecuteTask(context.Background(), payload); err != nil {
		t.Errorf("execution of cluster_scan handler failed: %v", err)
	}
}
