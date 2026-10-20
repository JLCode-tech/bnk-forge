/**
 * CNF Dashboard — types and constants.
 *
 * No special views — the CNF page is purely discovery-driven.
 * All sidebar items derive from runtime CRD data, not static lists.
 */

import type { CRDInfo } from "@/hooks/useCrds";

export type { CRDInfo };

/** A grouped category entry built at runtime from discovered CRDs. */
export interface CnfCategory {
  /** Category label (from CRDInfo.category, or the raw API group as fallback). */
  category: string;
  /**
   * Whether this category came from the static registry (curated) or from
   * the bare API group (discovered-only). Curated categories sort first.
   */
  enriched: boolean;
  items: CnfCategoryItem[];
}

export interface CnfCategoryItem {
  /** Stable key = CRDInfo.name (`<plural>.<group>`). */
  key: string;
  /** Human-readable label: display_name if present, else kind. */
  label: string;
  /** Source badge: 'registry-enriched' | 'discovered'. */
  source: string;
  /** Original CRD info, kept for detail-panel / table use. */
  crdInfo: CRDInfo;
}

/** Curated CNF & BNK 2.4.1 category definitions for static reference and enrichment. */
export const CURATED_CNF_CATEGORIES: ReadonlyArray<{
  slug: string;
  category: string;
  keys: readonly string[];
}> = [
  {
    slug: "ai-gateway",
    category: "AI Governance (2.4.1)",
    keys: [
      "apppolicy",
      "aigatewayprofile",
      "aitenant",
      "aimodel",
      "aiprovider",
      "aicredential",
      "aigateway",
    ],
  },
  {
    slug: "dns",
    category: "DNS & GSLB",
    keys: [
      "f5bigdnsapps",
      "f5bigdnsresolvercaches",
      "f5bigdnscache",
      "f5bigdnszones",
      "f5biggslbinstance",
      "f5biggslbzone",
      "f5biggslbpool",
      "f5biggslbwideip",
    ],
  },
  {
    slug: "telco",
    category: "Carrier-Grade & Telco",
    keys: ["f5bigcgnats", "f5bigdiameters", "f5bigipams"],
  },
  {
    slug: "metrics",
    category: "Observability & Metrics (2.4.1)",
    keys: ["scrapetemplate", "scrapeclass", "scrape"],
  },
];

export const CNF_YAML_TEMPLATES: Record<string, (namespace: string) => string> =
  {
    apppolicy: (namespace) => `apiVersion: gateway.k8s.f5.com/v1
kind: AppPolicy
metadata:
  name: my-ai-app-policy
  namespace: ${namespace}
spec:
  targetRefs:
    - group: gateway.networking.k8s.io
      kind: HTTPRoute
      name: llm-inference-route
  extensionRefs:
    - group: k8s.f5net.com
      kind: AIGatewayProfile
      name: enterprise-ai-profile`,

    aitenant: (namespace) => `apiVersion: k8s.f5net.com/v1
kind: AITenant
metadata:
  name: enterprise-tenant
  namespace: ${namespace}
spec:
  displayName: Enterprise AI Tenant
  rateLimit:
    requestsPerMinute: 120
    tokensPerMinute: 60000
  allowedModels:
    - gpt-4o-enterprise
    - llama-3-70b-instruct`,

    aicredential: (namespace) => `apiVersion: k8s.f5net.com/v1
kind: AICredential
metadata:
  name: openai-api-credential
  namespace: ${namespace}
spec:
  providerType: openai
  secretRef:
    name: openai-api-key-secret
    key: apiKey
  headerName: Authorization
  headerPrefix: Bearer`,

    aiprovider: (namespace) => `apiVersion: k8s.f5net.com/v1
kind: AIProvider
metadata:
  name: openai-upstream
  namespace: ${namespace}
spec:
  type: openai
  endpoint: https://api.openai.com/v1
  credentialRef:
    name: openai-api-credential
  timeoutSeconds: 60`,

    aimodel: (namespace) => `apiVersion: k8s.f5net.com/v1
kind: AIModel
metadata:
  name: gpt-4o-enterprise
  namespace: ${namespace}
spec:
  modelName: gpt-4o
  providerRef:
    name: openai-upstream
  maxInputTokens: 8192
  maxOutputTokens: 4096`,

    aigatewayprofile: (namespace) => `apiVersion: k8s.f5net.com/v1
kind: AIGatewayProfile
metadata:
  name: enterprise-ai-profile
  namespace: ${namespace}
spec:
  tenantRefs:
    - name: enterprise-tenant
  modelRefs:
    - name: gpt-4o-enterprise
  promptGuardrails:
    piiRedaction: true
    promptInjectionProtection: true
  telemetry:
    tokenAccounting: true`,

    aigateway: (namespace) => `apiVersion: k8s.f5net.com/v1
kind: AIGateway
metadata:
  name: main-ai-gateway
  namespace: ${namespace}
spec:
  gatewayRef:
    name: main-gateway
    namespace: ${namespace}
  profileRef:
    name: enterprise-ai-profile
  console:
    enabled: true`,

    scrapetemplate: (namespace) => `apiVersion: metrics.f5.com/v1
kind: ScrapeTemplate
metadata:
  name: tmm-prometheus-template
  namespace: ${namespace}
spec:
  interval: 15s
  scrapeTimeout: 10s
  path: /metrics
  port: 9090`,

    scrapeclass: (namespace) => `apiVersion: metrics.f5.com/v1
kind: ScrapeClass
metadata:
  name: bnk-dataplane-scrapeclass
  namespace: ${namespace}
spec:
  templateRef:
    name: tmm-prometheus-template
  scheme: http`,

    scrape: (namespace) => `apiVersion: metrics.f5.com/v1
kind: Scrape
metadata:
  name: cne-tmm-scrape
  namespace: ${namespace}
spec:
  scrapeClassName: bnk-dataplane-scrapeclass
  selector:
    matchLabels:
      app: f5-tmm`,

    f5bigdnsapps: (namespace) => `apiVersion: k8s.f5net.com/v1
kind: F5BigDnsApp
metadata:
  name: edge-dns-listener
  namespace: ${namespace}
spec:
  ip: 10.10.20.53
  port: 53
  protocol: udp
  dnsCache: resolver-cache-main
  snat: automap`,

    f5bigdnsresolvercaches: (namespace) => `apiVersion: k8s.f5net.com/v1
kind: F5BigDnsResolverCache
metadata:
  name: resolver-cache-main
  namespace: ${namespace}
spec:
  type: validating-resolver
  maxMessageCacheSize: 10485760
  maxResourceRecordCacheSize: 52428800
  forwardZones:
    - name: corp.example.com
      nameservers:
        - 10.10.1.53:53`,

    f5bigdnscache: (namespace) => `apiVersion: k8s.f5net.com/v1
kind: F5BigDnsCache
metadata:
  name: dns-cache-profile
  namespace: ${namespace}
spec:
  resolverType: transparent
  msgCacheSize: 10485760
  rrsetCacheSize: 52428800
  useIpv4: true
  useIpv6: true`,

    f5bigdnszones: (namespace) => `apiVersion: k8s.f5net.com/v1
kind: F5BigDnsZone
metadata:
  name: example-com-zone
  namespace: ${namespace}
spec:
  dnsExpress:
    enabled: true
    server: primary-ns.example.com
    notifyAction: consume
  dnssec:
    enabled: true`,

    f5biggslbinstance: (namespace) => `apiVersion: k8s.f5net.com/v1
kind: F5BigGslbInstance
metadata:
  name: gslb-dc-east
  namespace: ${namespace}
spec:
  dataCenter: dc-east
  listenerIp: 10.20.30.53
  port: 53`,

    f5biggslbzone: (namespace) => `apiVersion: k8s.f5net.com/v1
kind: F5BigGslbZone
metadata:
  name: gslb-zone-example
  namespace: ${namespace}
spec:
  domainName: gslb.example.com
  ttl: 300
  dnssecEnabled: false`,

    f5biggslbpool: (namespace) => `apiVersion: k8s.f5net.com/v1
kind: F5BigGslbPool
metadata:
  name: gslb-pool-api
  namespace: ${namespace}
spec:
  recordType: A
  loadBalancingMode: round-robin
  fallbackMode: return-to-dns
  members:
    - ip: 198.51.100.10
      port: 443
      ratio: 1`,

    f5biggslbwideip: (namespace) => `apiVersion: k8s.f5net.com/v1
kind: F5BigGslbWideIp
metadata:
  name: wideip-api-example
  namespace: ${namespace}
spec:
  fqdn: api.gslb.example.com
  recordType: A
  poolLoadBalancingMode: round-robin
  pools:
    - name: gslb-pool-api
      order: 0
      ratio: 1`,

    f5bigcgnats: (namespace) => `apiVersion: k8s.f5net.com/v1
kind: F5BigCgnat
metadata:
  name: subscriber-cgnat-napt
  namespace: ${namespace}
spec:
  mode: napt
  sourceAddresses:
    - 100.64.0.0/10
  natPool:
    prefix: 198.51.100.0/24
  portBlockAllocation:
    blockSize: 512
    maxBlocksPerSubscriber: 4
  hairpinMode: true`,

    f5bigdiameters: (namespace) => `apiVersion: k8s.f5net.com/v1
kind: F5BigDiameter
metadata:
  name: gy-charging-diameter
  namespace: ${namespace}
spec:
  originHost: cnf-tmm.epc.mnc001.mcc001.3gppnetwork.org
  originRealm: epc.mnc001.mcc001.3gppnetwork.org
  applicationId: 4
  vendorId: 10415
  watchdogTimer: 30
  peers:
    - host: ocs01.epc.mnc001.mcc001.3gppnetwork.org
      ip: 10.30.40.10
      port: 3868`,

    f5bigipams: (namespace) => `apiVersion: k8s.f5net.com/v1
kind: F5BigIpam
metadata:
  name: cnf-subscriber-ipam
  namespace: ${namespace}
spec:
  provider: f5-ipam-controller
  cidr: 198.51.100.0/24
  gateway: 198.51.100.1
  ipRanges:
    - start: 198.51.100.10
      end: 198.51.100.250`,
  };

const CNF_TEMPLATE_ALIASES: Record<string, string> = {
  apppolicies: "apppolicy",
  aitenants: "aitenant",
  aicredentials: "aicredential",
  aiproviders: "aiprovider",
  aimodels: "aimodel",
  aigatewayprofiles: "aigatewayprofile",
  aigateways: "aigateway",
  scrapetemplates: "scrapetemplate",
  scrapeclasses: "scrapeclass",
  scrapes: "scrape",
  f5bigdnsapp: "f5bigdnsapps",
  f5bigdnsresolvercache: "f5bigdnsresolvercaches",
  f5bigdnscaches: "f5bigdnscache",
  f5bigdnszone: "f5bigdnszones",
  f5biggslbinstances: "f5biggslbinstance",
  f5biggslbzones: "f5biggslbzone",
  f5biggslbpools: "f5biggslbpool",
  f5biggslbwideips: "f5biggslbwideip",
  f5bigcgnat: "f5bigcgnats",
  f5bigdiameter: "f5bigdiameters",
  f5bigipam: "f5bigipams",
};

export const YAML_TEMPLATES = CNF_YAML_TEMPLATES;

/**
 * Look up a YAML template for a CNF or BNK 2.4.1 resource key or `<plural>.<group>` CRD name.
 */
export function getCnfYamlTemplate(
  resourceType: string,
  namespace = "default",
): string | undefined {
  const normalized = resourceType.trim().toLowerCase();
  const baseKey = normalized.includes(".")
    ? normalized.split(".")[0]
    : normalized;
  const canonicalKey = CNF_TEMPLATE_ALIASES[baseKey] ?? baseKey;
  const builder =
    CNF_YAML_TEMPLATES[canonicalKey] ?? CNF_YAML_TEMPLATES[normalized];
  return builder ? builder(namespace) : undefined;
}
