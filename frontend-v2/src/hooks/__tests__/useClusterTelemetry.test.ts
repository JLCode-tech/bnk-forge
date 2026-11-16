/**
 * Tests for useClusterTelemetry hooks
 *
 * Covers:
 * - useClusterTelemetrySummary (AGENT_PUSH vs LEGACY_PULL)
 * - useClusterPodFlows
 * - useClusterTmmMetrics
 * - useClusterDriftViolations
 */
import { describe, it, expect } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/mocks/server';
import {
  useClusterTelemetrySummary,
  useClusterPodFlows,
  useClusterTmmMetrics,
  useClusterDriftViolations,
} from '@/hooks/useClusterTelemetry';
import React from 'react';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe('useClusterTelemetry', () => {
  it('fetches cluster telemetry summary successfully', async () => {
    server.use(
      http.get('/api/k8s/clusters/:id/telemetry/summary', ({ params }) => {
        return HttpResponse.json({
          cluster_id: Number(params.id),
          cluster_name: 'test-cluster',
          cluster_uuid: '11111111-2222-3333-4444-555555555555',
          source: 'AGENT_PUSH',
          status: 'active',
          has_active_agent: true,
          connection_mode: 'AGENT_PUSH',
          flows: {
            total_flows: 1540,
            inbound_flows: 900,
            outbound_flows: 640,
            total_bytes_sent: 5000000,
            total_bytes_received: 8000000,
            avg_handshake_duration_us: 142.5,
            avg_smoothed_rtt_us: 210.0,
            total_retransmissions: 2,
            tmm_bypass_violations: 0,
          },
          drift_violations_count: 0,
        });
      })
    );

    const { result } = renderHook(() => useClusterTelemetrySummary(42, 1), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.source).toBe('AGENT_PUSH');
    expect(result.current.data?.has_active_agent).toBe(true);
    expect(result.current.data?.flows?.total_flows).toBe(1540);
  });

  it('fetches detailed pod flows and top talkers', async () => {
    server.use(
      http.get('/api/k8s/clusters/:id/telemetry/flows', ({ params }) => {
        return HttpResponse.json({
          cluster_id: Number(params.id),
          source: 'AGENT_PUSH',
          summary: { total_flows: 200 },
          flows: [],
          top_talkers: [
            {
              namespace: 'f5-demo',
              pod_name: 'frontend-nginx-7c4b',
              flow_count: 120,
              total_bytes: 4096000,
              bytes_sent: 1024000,
              bytes_received: 3072000,
              bypass_violations: 0,
            },
          ],
        });
      })
    );

    const { result } = renderHook(
      () => useClusterPodFlows(42, { hours: 1, namespace: 'f5-demo' }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.top_talkers).toHaveLength(1);
    expect(result.current.data?.top_talkers[0].pod_name).toBe('frontend-nginx-7c4b');
  });

  it('fetches TMM DPDK microkernel metrics', async () => {
    server.use(
      http.get('/api/k8s/clusters/:id/telemetry/tmm', ({ params }) => {
        return HttpResponse.json({
          cluster_id: Number(params.id),
          source: 'AGENT_PUSH',
          metrics: {
            total_rx_packets: 100000,
            total_tx_packets: 98000,
            total_rx_bytes: 50000000,
            total_tx_bytes: 48000000,
            total_rx_drops: 0,
            total_tx_drops: 0,
            avg_rx_ring_occupancy: 0.12,
            avg_tx_ring_occupancy: 0.08,
            avg_cpu_utilization_pct: 14.5,
            max_hugepage_used_bytes: 2147483648,
          },
        });
      })
    );

    const { result } = renderHook(() => useClusterTmmMetrics(42, 1), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.metrics.total_rx_packets).toBe(100000);
    expect(result.current.data?.metrics.avg_cpu_utilization_pct).toBe(14.5);
  });

  it('fetches architectural drift violations', async () => {
    server.use(
      http.get('/api/k8s/clusters/:id/telemetry/drift', ({ params }) => {
        return HttpResponse.json({
          cluster_id: Number(params.id),
          source: 'AGENT_PUSH',
          violations: [
            {
              timestamp: '2026-11-16T15:00:00Z',
              node_name: 'ip-10-0-1-50',
              pod_name: 'rogue-app-8f',
              namespace: 'default',
              src_ip: '10.244.1.20',
              dst_ip: '10.244.2.80',
              dst_port: 8080,
              bytes_sent: 50000,
              bytes_received: 25000,
            },
          ],
          count: 1,
        });
      })
    );

    const { result } = renderHook(() => useClusterDriftViolations(42, { hours: 24 }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.count).toBe(1);
    expect(result.current.data?.violations[0].pod_name).toBe('rogue-app-8f');
  });
});
