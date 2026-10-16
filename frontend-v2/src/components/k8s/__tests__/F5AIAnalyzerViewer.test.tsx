import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import { F5AIAnalyzerViewer } from '../F5AIAnalyzerViewer';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/mocks/server';

// Minimal F5BigAnalyzer CR with no status conditions (the common real-world case
// where the controller never writes .status.conditions).
const analyzerNoConditions = {
  metadata: { name: 'no-cond-analyzer', namespace: 'bnk-demo', uid: 'uid-nc', creationTimestamp: '2026-01-01T00:00:00Z' },
  spec: {
    schedule: '15m',
    applications: [],
    dataSources: [],
    script: { type: 'builtin', builtin: { name: 'roundrobin' } },
  },
  status: {},
};

describe('F5AIAnalyzerViewer', () => {
  beforeEach(() => {
    // Default: return empty analyzers
    server.use(
      http.get('*/api/k8s/clusters/:id/resources/:type', ({ params }) => {
        if (params.type === 'f5biganalyzer') {
          return HttpResponse.json({ resources: [] });
        }
        return HttpResponse.json({ resources: [] });
      })
    );
  });

  it('shows empty state (no synthetic card) when no CRs exist', async () => {
    render(<F5AIAnalyzerViewer clusterId={1} />);

    await waitFor(() => {
      expect(screen.getByText(/no analyzer CR found/i)).toBeInTheDocument();
    });
    // Must NOT render a synthetic "preview (no analyzer CR)" card — that was
    // a prior placeholder that read like a stale CR.
    expect(screen.queryByText(/preview \(no analyzer CR\)/i)).not.toBeInTheDocument();
    expect(screen.getByText(/No F5BigAnalyzer resources in this cluster yet/i)).toBeInTheDocument();
  });

  it('shows analyzer card with name and metadata when data returned', async () => {
    server.use(
      http.get('*/api/k8s/clusters/:id/resources/:type', () => {
        return HttpResponse.json({
          resources: [
            {
              metadata: { name: 'test-analyzer', namespace: 'bnk-demo', uid: 'uid-1', creationTimestamp: '2026-01-01T00:00:00Z' },
              spec: {
                schedule: '15m',
                applications: [{ kind: 'HTTPRoute', group: 'gateway.networking.k8s.io', name: 'my-route', namespace: 'bnk-demo' }],
                dataSources: [{ name: 'prometheus', type: 'prometheus', endpoint: 'http://prom:9090' }],
                script: { type: 'builtin', builtin: { name: 'roundrobin' } },
              },
              status: { conditions: [{ type: 'Programmed', status: 'True' }] },
            },
          ],
        });
      })
    );

    render(<F5AIAnalyzerViewer clusterId={1} />);

    await waitFor(() => {
      expect(screen.getByText('test-analyzer')).toBeInTheDocument();
    });
    expect(screen.getByText('Every 15 minutes')).toBeInTheDocument();
    expect(screen.getByText('1 application')).toBeInTheDocument();
    expect(screen.getByText('1 data source')).toBeInTheDocument();
  });

  it('shows error state on API failure', async () => {
    server.use(
      http.get('*/api/k8s/clusters/:id/resources/:type', () => {
        return HttpResponse.json({ error: 'Forbidden' }, { status: 403 });
      })
    );

    render(<F5AIAnalyzerViewer clusterId={1} />);

    await waitFor(() => {
      expect(screen.getByText('Permission Denied')).toBeInTheDocument();
    });
  });

  it('shows Active (not Pending) when CR has no status conditions but backend health is available', async () => {
    server.use(
      http.get('*/api/k8s/clusters/:id/resources/:type', () => {
        return HttpResponse.json({ resources: [analyzerNoConditions] });
      }),
      http.get('*/api/k8s/clusters/:id/analyzers/:ns/:name/backend-health', () => {
        return HttpResponse.json({
          available: true,
          backends: [
            {
              pod_name: 'llm-pod-0',
              namespace: 'bnk-demo',
              backend_kind: 'vllm',
              model: 'llama3',
              status: 'healthy',
              kv_cache_used_pct: 20,
              running: 2,
              waiting: 0,
              ttft_p95_ms: 120,
              itl_p95_ms: 10,
              output_tps: 50,
              gpu_util_pct: null,
              vram_used_gb: null,
              vram_total_gb: null,
              gpu_temp_c: null,
            },
          ],
          errors: {},
          updated_at: '2026-01-01T00:00:00Z',
        });
      }),
    );

    render(<F5AIAnalyzerViewer clusterId={1} />);

    await waitFor(() => {
      expect(screen.getByText('Active')).toBeInTheDocument();
    });
    expect(screen.queryByText('Pending')).not.toBeInTheDocument();
  });

  it('shows Pending when CR has no status conditions and backend health data is absent', async () => {
    server.use(
      http.get('*/api/k8s/clusters/:id/resources/:type', () => {
        return HttpResponse.json({ resources: [analyzerNoConditions] });
      }),
      http.get('*/api/k8s/clusters/:id/analyzers/:ns/:name/backend-health', () => {
        return HttpResponse.json({
          available: false,
          reason: 'no resolvable backend pods',
          backends: [],
          errors: {},
          updated_at: '2026-01-01T00:00:00Z',
        });
      }),
    );

    render(<F5AIAnalyzerViewer clusterId={1} />);

    await waitFor(() => {
      expect(screen.getByText('Pending')).toBeInTheDocument();
    });
    expect(screen.queryByText('Active')).not.toBeInTheDocument();
  });

  it('renders EPP Real-Time Dashboard when F5EPP resource is present', async () => {
    server.use(
      http.get('*/api/k8s/clusters/:id/resources/:type', ({ params }) => {
        if (params.type === 'f5epp') {
          return HttpResponse.json({
            resources: [
              {
                apiVersion: 'inference.k8s.f5.com/v1alpha1',
                kind: 'F5EPP',
                metadata: { name: 'vllm-pool-epp', namespace: 'default' },
                spec: {
                  engine: 'vllm',
                  poolRef: 'vllm-pool',
                  blockSize: 64,
                  mode: 'aggregated',
                  tokenizer: 'unsloth/Llama-3.3-70B-Instruct',
                },
                status: {
                  conditions: [{ type: 'Ready', status: 'True' }],
                },
              },
            ],
          });
        }
        return HttpResponse.json({ resources: [] });
      }),
      http.get('*/api/k8s/clusters/:id/analyzers/:ns/:name/runtime-metrics', () => {
        return HttpResponse.json({
          available: true,
          kind: 'F5EPP',
          name: 'vllm-pool-epp',
          namespace: 'default',
          summary: {
            cache_hit_rate_pct: 68.4,
            ttft_p50_ms: 1517.5,
            ttft_p95_ms: 2405.0,
            itl_p50_ms: 28.3,
            itl_p95_ms: 48.2,
            e2e_p95_ms: 3820.0,
            output_tps: 12915.2,
            prompt_tps: 452100.0,
            total_tps: 465015.2,
            num_requests_running: 4,
            num_requests_waiting: 0,
            kv_cache_usage_pct: 42.1,
            num_pods: 4,
          },
          endpoints: [
            {
              pod_name: 'vllm-deployment-64d5c94fc4-22b64',
              address: '10.0.1.40:8000',
              status: 'Healthy',
              traffic_share_pct: 27.2,
              kv_cache_usage_pct: 41.5,
              running_requests: 1,
              waiting_requests: 0,
              itl_p95_ms: 47.8,
              ttft_p95_ms: 2390.0,
              total_tokens: 182000,
            },
          ],
        });
      })
    );

    render(<F5AIAnalyzerViewer clusterId={1} />);

    await waitFor(() => {
      expect(screen.getByText('F5 EPP Real-Time AI Analyzer')).toBeInTheDocument();
    });
    expect(screen.getByText('Prefix Cache')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('68.4%')).toBeInTheDocument();
    });
    expect(screen.getByText('Output TPS')).toBeInTheDocument();
  });
});
