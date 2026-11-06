/**
 * Shared number/label formatters for the observability surfaces.
 * Kept tiny and dependency-free so both pages and primitives can reuse them.
 */

/** Compact integer with thousands separators (e.g. 12,345). */
export function fmtInt(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  return Math.round(value).toLocaleString();
}

/** Compact large numbers as 1.2K / 3.4M. */
export function fmtCompact(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return Math.round(value).toLocaleString();
}

/** USD cost with adaptive precision. */
export function fmtCost(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  if (value === 0) return '$0.00';
  if (Math.abs(value) < 0.01) return `$${value.toFixed(4)}`;
  if (Math.abs(value) < 1) return `$${value.toFixed(3)}`;
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Latency in ms with one decimal. */
export function fmtLatencyMs(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `${value.toFixed(1)} ms`;
}

/** Ratio (0..1) as a percentage. */
export function fmtPct(value: number | null | undefined, digits = 1): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `${(value * 100).toFixed(digits)}%`;
}

/** Infer provider from model id or provider name — parity with backend _normalize_provider. */
export function inferProvider(modelOrProvider: string): string {
  const m = (modelOrProvider || '').toLowerCase().trim();
  if (!m) return 'unknown';

  // 1. Direct provider identifiers & common prefix patterns
  if (m.startsWith('azure') || m.includes('foundry')) return 'azure';
  if (m.startsWith('bedrock') || m.startsWith('aws') || m.startsWith('amazon.') || m.startsWith('titan')) return 'aws';
  if (m.startsWith('vertex') || m.startsWith('gcp') || m.startsWith('google.') || m.startsWith('gemini') || m.startsWith('gemma')) return 'google';
  if (m.startsWith('anthropic.') || m.startsWith('claude')) return 'anthropic';
  if (m.startsWith('openai.') || /^(gpt|o1|o3|o4|text-embedding|dall-e)/.test(m)) return 'openai';
  if (m.startsWith('meta.') || m.startsWith('llama')) return 'meta';
  if (m.startsWith('mistral.') || m.startsWith('mistral') || m.startsWith('mixtral') || m.startsWith('codestral')) return 'mistral';
  if (m.startsWith('deepseek.') || m.startsWith('deepseek')) return 'deepseek';
  if (m.startsWith('qwen.') || m.startsWith('qwen')) return 'qwen';
  if (m.startsWith('cohere.') || m.startsWith('command')) return 'cohere';
  if (m.startsWith('mcp') || m.startsWith('tool')) return 'mcp';
  if (m.startsWith('ollama')) return 'ollama';
  if (m.startsWith('vllm')) return 'vllm';

  // 2. Handle prefix with slash e.g. "azure/gpt-4o", "bedrock/anthropic.claude"
  if (m.includes('/')) {
    const [prefix, remainder] = m.split('/', 2);
    if (['openai', 'azure', 'anthropic', 'google', 'meta', 'mistral', 'deepseek', 'cohere', 'qwen', 'mcp', 'ollama', 'vllm'].includes(prefix)) {
      return prefix;
    }
    if (prefix === 'bedrock' || prefix === 'aws') {
      const sub = inferProvider(remainder);
      return sub !== 'unknown' ? sub : 'aws';
    }
    if (prefix === 'vertex' || prefix === 'gcp') {
      const sub = inferProvider(remainder);
      return sub !== 'unknown' ? sub : 'google';
    }
    return inferProvider(remainder);
  }

  // 3. Substring checks for embedded model family names
  if (m.includes('claude')) return 'anthropic';
  if (m.includes('gemini') || m.includes('gemma')) return 'google';
  if (m.includes('llama')) return 'meta';
  if (m.includes('mistral') || m.includes('mixtral')) return 'mistral';
  if (m.includes('deepseek')) return 'deepseek';
  if (m.includes('qwen')) return 'qwen';
  if (m.includes('titan')) return 'aws';
  if (m.includes('phi-') || m.includes('phi3') || m.includes('phi4')) return 'azure';

  return 'unknown';
}
