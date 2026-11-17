package lease

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func isK8sMicroTime(ts string) bool {
	if len(ts) != len(k8sMicroTimeFormat) || ts[19] != '.' || ts[26] != 'Z' {
		return false
	}
	_, err := time.Parse(k8sMicroTimeFormat, ts)
	return err == nil
}

type roundTripperFunc func(*http.Request) (*http.Response, error)

func (f roundTripperFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

func TestLeaseElectionMock(t *testing.T) {
	var mu sync.Mutex
	var storedLease *Lease

	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()

		switch r.Method {
		case http.MethodGet:
			if storedLease == nil {
				http.NotFound(w, r)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(storedLease)

		case http.MethodPost:
			var l Lease
			if err := json.NewDecoder(r.Body).Decode(&l); err != nil {
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			if !isK8sMicroTime(*l.Spec.AcquireTime) || !isK8sMicroTime(*l.Spec.RenewTime) {
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			l.Metadata.ResourceVersion = "1"
			storedLease = &l
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(storedLease)

		case http.MethodPut:
			var l Lease
			if err := json.NewDecoder(r.Body).Decode(&l); err != nil {
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			if !isK8sMicroTime(*l.Spec.RenewTime) {
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			l.Metadata.ResourceVersion = "2"
			storedLease = &l
			w.WriteHeader(http.StatusOK)
			_ = json.NewEncoder(w).Encode(storedLease)

		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	})

	inMemoryTransport := roundTripperFunc(func(req *http.Request) (*http.Response, error) {
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		resp := rec.Result()
		resp.Request = req
		return resp, nil
	})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	cfg1 := Config{
		Enabled:        true,
		LeaseName:      "forge-agent-leader",
		LeaseNamespace: "forge-system",
		Identity:       "node-1",
		LeaseDuration:  2 * time.Second,
		RenewDeadline:  200 * time.Millisecond,
		KubeAPIServer:  "https://kubernetes.default.svc",
		RoundTripper:   inMemoryTransport,
	}

	elector1, err := NewElector(cfg1)
	if err != nil {
		t.Fatalf("failed to create elector1: %v", err)
	}

	// 1. Initial acquisition should succeed for node-1
	acquired, err := elector1.TryAcquireOrRenew(ctx)
	if err != nil {
		t.Fatalf("node-1 acquisition failed: %v", err)
	}
	if !acquired {
		t.Fatalf("expected node-1 to acquire lease")
	}

	// 2. node-2 attempting immediately should NOT acquire
	cfg2 := Config{
		Enabled:        true,
		LeaseName:      "forge-agent-leader",
		LeaseNamespace: "forge-system",
		Identity:       "node-2",
		LeaseDuration:  2 * time.Second,
		RenewDeadline:  200 * time.Millisecond,
		KubeAPIServer:  "https://kubernetes.default.svc",
		RoundTripper:   inMemoryTransport,
	}
	elector2, err := NewElector(cfg2)
	if err != nil {
		t.Fatalf("failed to create elector2: %v", err)
	}

	acquired2, err := elector2.TryAcquireOrRenew(ctx)
	if err != nil {
		t.Fatalf("node-2 acquire check returned error: %v", err)
	}
	if acquired2 {
		t.Fatalf("node-2 should not acquire active lease of node-1")
	}

	// 3. node-1 renewing lease
	renewed, err := elector1.TryAcquireOrRenew(ctx)
	if err != nil || !renewed {
		t.Fatalf("node-1 failed to renew lease: %v", err)
	}

	// 4. Test Run loop callbacks
	var leadingCount int32
	var stoppedCount int32

	loopCtx, loopCancel := context.WithTimeout(context.Background(), 150*time.Millisecond)
	defer loopCancel()

	elector1.Run(loopCtx, func() {
		atomic.AddInt32(&leadingCount, 1)
	}, func() {
		atomic.AddInt32(&stoppedCount, 1)
	})

	if atomic.LoadInt32(&leadingCount) == 0 {
		t.Errorf("expected leading callback to have executed")
	}
}

func TestLeaseDisabled(t *testing.T) {
	cfg := Config{
		Enabled: false,
	}
	elector, err := NewElector(cfg)
	if err != nil {
		t.Fatalf("create elector failed: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	acquired, err := elector.TryAcquireOrRenew(ctx)
	if err != nil || !acquired {
		t.Fatalf("expected true when disabled")
	}
}
