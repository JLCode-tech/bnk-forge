package aigw

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

type roundTripperFunc func(*http.Request) (*http.Response, error)

func (f roundTripperFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

func inMemoryClient(h http.HandlerFunc) *http.Client {
	return &http.Client{
		Transport: roundTripperFunc(func(req *http.Request) (*http.Response, error) {
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)
			resp := rec.Result()
			resp.Request = req
			return resp, nil
		}),
	}
}

func TestCollectorPollsClickHouseWithSecretAuth(t *testing.T) {
	kubeClient := inMemoryClient(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/namespaces/f5-cne-system/secrets/f5-aigateway-clickhouse-auth" {
			_ = json.NewEncoder(w).Encode(map[string]any{
				"data": map[string]string{
					"password": base64.StdEncoding.EncodeToString([]byte("secret-otel-pw")),
				},
			})
			return
		}
		http.NotFound(w, r)
	})

	var calls int32
	chClient := inMemoryClient(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-ClickHouse-User") != "otel" || r.Header.Get("X-ClickHouse-Key") != "secret-otel-pw" {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		n := atomic.AddInt32(&calls, 1)
		if n == 1 {
			_, _ = w.Write([]byte(`{"ts_ms":1700000000123,"client_id":"fx-arbitrage-agent","model_name":"claude-sonnet-4-5","route_name":"sovereign-wealth-apac","prompt_tokens":400,"completion_tokens":120,"time_to_first_token_ms":110,"total_latency_ms":520,"status_code":200,"cost_usd":0.003}` + "\n"))
		}
	})

	col := NewCollector(Config{
		ClusterID:      "11111111-1111-1111-1111-111111111111",
		ClickHouseURL:  "http://f5-aigateway-clickhouse.f5-cne-system.svc.cluster.local:8123",
		KubeAPIServer:  "https://kubernetes.default.svc",
		KubeHTTPClient: kubeClient,
		HTTPClient:     chClient,
		PollInterval:   50 * time.Millisecond,
	})
	col.kubeToken = "test-sa-token"
	col.lastTsMs = 1700000000000

	col.pollOnce(context.Background())

	select {
	case ev := <-col.Events():
		if ev.ModelName != "claude-sonnet-4-5" || ev.ClientID != "fx-arbitrage-agent" || ev.PromptTokens != 400 || ev.StatusCode != 200 {
			t.Fatalf("unexpected event: %+v", ev)
		}
		if ev.ClusterID != "11111111-1111-1111-1111-111111111111" {
			t.Fatalf("unexpected cluster_id: %s", ev.ClusterID)
		}
	case <-time.After(1 * time.Second):
		t.Fatal("timed out waiting for AI Gateway event")
	}

	col.pollOnce(context.Background())
	if col.lastTsMs != 1700000000123 {
		t.Fatalf("expected watermark 1700000000123, got %d", col.lastTsMs)
	}
}

func TestCollectorSkipsWhenNotLeader(t *testing.T) {
	var hit int32
	chClient := inMemoryClient(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hit, 1)
	})

	col := NewCollector(Config{
		ClusterID:          "11111111-1111-1111-1111-111111111111",
		ClickHouseURL:      "http://f5-aigateway-clickhouse.f5-cne-system.svc.cluster.local:8123",
		ClickHousePassword: "pw",
		HTTPClient:         chClient,
		IsLeader:           func() bool { return false },
	})

	col.pollOnce(context.Background())
	if atomic.LoadInt32(&hit) != 0 {
		t.Fatalf("expected non-leader not to poll ClickHouse, got %d hits", hit)
	}
}
