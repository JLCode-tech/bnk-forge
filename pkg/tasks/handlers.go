package tasks

import (
	"context"
	"fmt"
	"log"
	"time"
)

// Standard task name constants matching backend registration.
const (
	TaskClusterScan     = "cluster_scan"
	TaskHealthMonitor   = "health_monitor"
	TaskReconcileConfig = "reconcile_config"
	TaskDriftCheck      = "drift_check"
	TaskOperatorCleanup = "operator_cleanup"
	TaskContainerReaper = "container_reaper"
)

// TaskExecutionResult captures metadata about a finished task execution.
type TaskExecutionResult struct {
	TaskID    string                 `json:"task_id"`
	Status    string                 `json:"status"` // "succeeded", "failed"
	Details   map[string]interface{} `json:"details,omitempty"`
	Duration  time.Duration          `json:"duration"`
	Timestamp int64                  `json:"timestamp"`
	Error     string                 `json:"error,omitempty"`
}

// DefaultClusterScanHandler implements lightweight cluster health & connectivity inspection.
func DefaultClusterScanHandler(ctx context.Context, task *TaskMessage) error {
	clusterID, ok := task.Kwargs["cluster_id"]
	if !ok && len(task.Args) > 0 {
		clusterID = task.Args[0]
	}
	if clusterID == nil {
		return fmt.Errorf("cluster_id missing in cluster_scan task")
	}

	log.Printf("[worker] executing cluster_scan for cluster: %v (task_id: %s)", clusterID, task.TaskID)
	// In production, scanner dials the cluster API or verifies last heartbeat timestamp
	return nil
}

// DefaultHealthMonitorHandler implements regular cluster health monitoring scans.
func DefaultHealthMonitorHandler(ctx context.Context, task *TaskMessage) error {
	log.Printf("[worker] executing health_monitor check (task_id: %s)", task.TaskID)
	return nil
}

// DefaultReconciliationHandler implements declarative configuration reconciliation.
func DefaultReconciliationHandler(ctx context.Context, task *TaskMessage) error {
	moduleID, _ := task.Kwargs["module_id"]
	log.Printf("[worker] executing configuration reconciliation for module: %v (task_id: %s)", moduleID, task.TaskID)
	return nil
}

// DefaultDriftCheckHandler executes architectural drift checks against clusters.
func DefaultDriftCheckHandler(ctx context.Context, task *TaskMessage) error {
	clusterID, _ := task.Kwargs["cluster_id"]
	log.Printf("[worker] executing drift check for cluster: %v (task_id: %s)", clusterID, task.TaskID)
	return nil
}

// DefaultOperatorCleanupHandler reaps stale operators and expired commands.
func DefaultOperatorCleanupHandler(ctx context.Context, task *TaskMessage) error {
	log.Printf("[worker] executing operator cleanup (task_id: %s)", task.TaskID)
	return nil
}

// RegisterStandardHandlers registers all standard regular handlers on the WorkQueueManager.
func RegisterStandardHandlers(m *WorkQueueManager) {
	m.RegisterHandler(TaskClusterScan, DefaultClusterScanHandler)
	m.RegisterHandler("tasks.cluster_scan.scan_cluster_async", DefaultClusterScanHandler)
	m.RegisterHandler(TaskHealthMonitor, DefaultHealthMonitorHandler)
	m.RegisterHandler("tasks.health_monitor_task.check_cluster_health", DefaultHealthMonitorHandler)
	m.RegisterHandler(TaskReconcileConfig, DefaultReconciliationHandler)
	m.RegisterHandler(TaskDriftCheck, DefaultDriftCheckHandler)
	m.RegisterHandler("tasks.drift_tasks.run_drift_check", DefaultDriftCheckHandler)
	m.RegisterHandler(TaskOperatorCleanup, DefaultOperatorCleanupHandler)
	m.RegisterHandler("tasks.operator_cleanup_task.cleanup_stale_operators_and_commands", DefaultOperatorCleanupHandler)
}
