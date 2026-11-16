package transport

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"

	"github.com/JLCode-tech/bnk-forge/pkg/protocol"
)

const (
	// DefaultMaxSpoolSize is 500MB
	DefaultMaxSpoolSize int64 = 500 * 1024 * 1024
	batchFilePrefix           = "wal-"
	batchFileExt              = ".batch"
)

// DiskSpool manages an on-disk Write-Ahead Log (WAL) queue for WAN outage resilience.
type DiskSpool interface {
	Enqueue(batch *protocol.TelemetryBatch) error
	Dequeue() (*protocol.TelemetryBatch, error)
	Peek() (*protocol.TelemetryBatch, error)
	Len() int
	ByteSize() int64
	Close() error
}

// SpoolConfig configures disk WAL storage.
type SpoolConfig struct {
	SpoolDir     string
	MaxSizeBytes int64
}

// FileDiskSpool implements DiskSpool using sequential atomic WAL files.
type FileDiskSpool struct {
	dir          string
	maxSizeBytes int64
	mu           sync.Mutex
	nextSeq      uint64
	currentBytes int64
	queue        []uint64
}

// NewFileDiskSpool opens or initializes the disk spool directory.
func NewFileDiskSpool(cfg SpoolConfig) (*FileDiskSpool, error) {
	if cfg.SpoolDir == "" {
		cfg.SpoolDir = "/tmp/forge-agent-spool"
	}
	if cfg.MaxSizeBytes <= 0 {
		cfg.MaxSizeBytes = DefaultMaxSpoolSize
	}

	if err := os.MkdirAll(cfg.SpoolDir, 0750); err != nil {
		return nil, fmt.Errorf("failed creating spool directory %s: %w", cfg.SpoolDir, err)
	}

	spool := &FileDiskSpool{
		dir:          cfg.SpoolDir,
		maxSizeBytes: cfg.MaxSizeBytes,
	}

	if err := spool.recover(); err != nil {
		return nil, fmt.Errorf("failed recovering spool state: %w", err)
	}

	return spool, nil
}

// recover scans the spool directory and reconstructs the FIFO queue.
func (s *FileDiskSpool) recover() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	entries, err := os.ReadDir(s.dir)
	if err != nil {
		return err
	}

	var seqs []uint64
	var totalBytes int64
	var maxSeq uint64

	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		if strings.HasPrefix(name, batchFilePrefix) && strings.HasSuffix(name, batchFileExt) {
			rawSeq := strings.TrimSuffix(strings.TrimPrefix(name, batchFilePrefix), batchFileExt)
			seq, err := strconv.ParseUint(rawSeq, 10, 64)
			if err != nil {
				continue
			}
			info, err := entry.Info()
			if err != nil {
				continue
			}
			seqs = append(seqs, seq)
			totalBytes += info.Size()
			if seq > maxSeq {
				maxSeq = seq
			}
		}
	}

	sort.Slice(seqs, func(i, j int) bool { return seqs[i] < seqs[j] })

	s.queue = seqs
	s.currentBytes = totalBytes
	s.nextSeq = maxSeq + 1

	// Enforce cap if existing files exceed limit
	s.enforceCapLocked()

	return nil
}

// Enqueue serializes and commits a telemetry batch to disk.
func (s *FileDiskSpool) Enqueue(batch *protocol.TelemetryBatch) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	data, err := json.Marshal(batch)
	if err != nil {
		return fmt.Errorf("failed marshaling batch for spool: %w", err)
	}

	seq := s.nextSeq
	s.nextSeq++

	fileName := fmt.Sprintf("%s%012d%s", batchFilePrefix, seq, batchFileExt)
	finalPath := filepath.Join(s.dir, fileName)
	tempPath := filepath.Join(s.dir, fmt.Sprintf(".tmp-%s", fileName))

	// Write to temporary file with sync
	f, err := os.OpenFile(tempPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0600)
	if err != nil {
		return fmt.Errorf("failed creating temp spool file: %w", err)
	}

	if _, err := f.Write(data); err != nil {
		_ = f.Close()
		_ = os.Remove(tempPath)
		return fmt.Errorf("failed writing spool data: %w", err)
	}

	if err := f.Sync(); err != nil {
		_ = f.Close()
		_ = os.Remove(tempPath)
		return fmt.Errorf("failed syncing spool data: %w", err)
	}
	_ = f.Close()

	// Atomic rename to finalize
	if err := os.Rename(tempPath, finalPath); err != nil {
		_ = os.Remove(tempPath)
		return fmt.Errorf("failed committing spool file: %w", err)
	}

	fileSize := int64(len(data))
	s.queue = append(s.queue, seq)
	s.currentBytes += fileSize

	s.enforceCapLocked()
	return nil
}

// Peek returns the oldest batch without removing it.
func (s *FileDiskSpool) Peek() (*protocol.TelemetryBatch, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if len(s.queue) == 0 {
		return nil, nil
	}

	seq := s.queue[0]
	filePath := filepath.Join(s.dir, fmt.Sprintf("%s%012d%s", batchFilePrefix, seq, batchFileExt))

	data, err := os.ReadFile(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed reading spool batch at %s: %w", filePath, err)
	}

	var batch protocol.TelemetryBatch
	if err := json.Unmarshal(data, &batch); err != nil {
		return nil, fmt.Errorf("corrupt batch in spool %s: %w", filePath, err)
	}

	return &batch, nil
}

// Dequeue retrieves and removes the oldest batch from the queue.
func (s *FileDiskSpool) Dequeue() (*protocol.TelemetryBatch, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if len(s.queue) == 0 {
		return nil, nil
	}

	seq := s.queue[0]
	fileName := fmt.Sprintf("%s%012d%s", batchFilePrefix, seq, batchFileExt)
	filePath := filepath.Join(s.dir, fileName)

	data, err := os.ReadFile(filePath)
	if err != nil {
		// If file was deleted or unreadable, discard seq from queue
		s.queue = s.queue[1:]
		return nil, fmt.Errorf("failed reading spool file: %w", err)
	}

	var batch protocol.TelemetryBatch
	if err := json.Unmarshal(data, &batch); err != nil {
		// Corrupt batch: discard and remove file
		_ = os.Remove(filePath)
		s.queue = s.queue[1:]
		return nil, fmt.Errorf("corrupt batch discarded: %w", err)
	}

	_ = os.Remove(filePath)
	s.queue = s.queue[1:]
	s.currentBytes -= int64(len(data))
	if s.currentBytes < 0 {
		s.currentBytes = 0
	}

	return &batch, nil
}

// enforceCapLocked discards the oldest files if storage exceeds maxSizeBytes.
func (s *FileDiskSpool) enforceCapLocked() {
	for s.currentBytes > s.maxSizeBytes && len(s.queue) > 0 {
		oldestSeq := s.queue[0]
		fileName := fmt.Sprintf("%s%012d%s", batchFilePrefix, oldestSeq, batchFileExt)
		filePath := filepath.Join(s.dir, fileName)

		if info, err := os.Stat(filePath); err == nil {
			s.currentBytes -= info.Size()
		}
		_ = os.Remove(filePath)
		s.queue = s.queue[1:]
	}
	if s.currentBytes < 0 {
		s.currentBytes = 0
	}
}

// Len returns the count of queued batches.
func (s *FileDiskSpool) Len() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.queue)
}

// ByteSize returns the approximate disk usage in bytes.
func (s *FileDiskSpool) ByteSize() int64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.currentBytes
}

// Close closes any resources.
func (s *FileDiskSpool) Close() error {
	return nil
}
