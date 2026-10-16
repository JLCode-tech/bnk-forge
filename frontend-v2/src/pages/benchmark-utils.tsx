/**
 * Benchmark badge and presentation components.
 * Pure constants, formatting, and calculation helpers live in benchmark-constants.ts.
 */
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Server,
  Anchor,
  TrendingUp,
  TrendingDown,
  BrainCircuit,
  Activity,
} from "lucide-react";
import {
  PROXY_LABELS,
  getRoutingEngine,
  isInferenceX,
  getRegressionStatus,
  type RegressionInput,
} from "./benchmark-constants";

// ============================================================================
// Badge Components
// ============================================================================

export { StatusBadge } from "@/components/ui/StatusBadge";

export function ProxyBadge({
  proxy,
  className,
}: {
  proxy: string;
  className?: string;
}) {
  const isF5 = proxy.startsWith("f5-bnk");
  const label = PROXY_LABELS[proxy] || proxy;
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1.5 text-xs whitespace-nowrap font-medium",
        isF5
          ? "border-primary/40 bg-primary/10 text-primary"
          : "border-border bg-muted/40 text-foreground",
        className,
      )}
    >
      <Server className="h-3 w-3 shrink-0 opacity-70" />
      {label}
    </Badge>
  );
}

export function RoutingEngineBadge({
  proxy,
  className,
}: {
  proxy: string;
  className?: string;
}) {
  const engine = getRoutingEngine(proxy);
  const isF5 = engine.tag === "f5";
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              "cursor-help inline-flex items-center px-1.5 py-0.5 rounded text-2xs font-medium border whitespace-nowrap transition-colors",
              isF5
                ? "border-primary/30 bg-primary/10 text-primary font-semibold"
                : "border-border/60 bg-muted/50 text-muted-foreground hover:text-foreground hover:border-border",
              className,
            )}
          >
            {engine.shortLabel}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs max-w-xs p-2.5">
          <p className="font-semibold text-foreground mb-0.5">{engine.label}</p>
          <p className="text-muted-foreground text-2xs leading-relaxed">
            {engine.description}
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function BenchmarkMethodologyBadge({
  scenarioKey,
  configSnapshot,
  tags,
  className,
}: {
  scenarioKey?: string | null;
  configSnapshot?: Record<string, unknown> | null;
  tags?: Record<string, string> | string[] | null;
  className?: string;
}) {
  const isInfX = isInferenceX(scenarioKey, configSnapshot, tags);
  if (isInfX) {
    return (
      <Badge
        variant="outline"
        className={cn(
          "bg-primary/10 text-foreground border-primary/30 gap-1.5 font-medium whitespace-nowrap text-2xs",
          className,
        )}
        title="InferenceX AgentX Benchmark (Agentic trace-driven evaluation with Claude Code multi-turn session trees, 128k context, and KV cache reuse)"
      >
        <BrainCircuit className="h-3 w-3 text-primary" />
        InferenceX AgentX
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className={cn(
        "bg-muted/50 text-muted-foreground border-border gap-1.5 font-medium whitespace-nowrap text-2xs",
        className,
      )}
      title="AIPerf Synthetic Benchmark (Standard fixed ISL/OSL synthetic concurrency sweep)"
    >
      <Activity className="h-3 w-3 text-muted-foreground" />
      AIPerf Synthetic
    </Badge>
  );
}

export function RegressionBadge({ run }: { run: RegressionInput }) {
  const status = getRegressionStatus(run);
  if (!status || status === "neutral") return null;

  if (status === "baseline") {
    return (
      <Badge variant="info" className="gap-1">
        <Anchor className="h-3 w-3" />
        Baseline
      </Badge>
    );
  }
  if (status === "regression") {
    return (
      <Badge variant="destructive" className="gap-1">
        <TrendingDown className="h-3 w-3" />
        Regression
      </Badge>
    );
  }
  return (
    <Badge variant="success" className="gap-1">
      <TrendingUp className="h-3 w-3" />
      Improved
    </Badge>
  );
}
