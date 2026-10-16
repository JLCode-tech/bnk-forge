import { SectionCard } from "@/components/ui/section-card";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useSystemHealth } from "@/hooks/useSystem";
import { Activity, Database, HardDrive, Server } from "lucide-react";
import type { ServiceStatus } from "@/types/system";

interface ServiceItemProps {
  name: string;
  status: ServiceStatus;
  icon: React.ReactNode;
}

function ServiceItem({ name, status, icon }: ServiceItemProps) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-border last:border-0">
      <div className="flex items-center gap-3">
        <div className="text-muted-foreground">{icon}</div>
        <div>
          <p className="font-medium">{name}</p>
          {status.error && (
            <p className="text-sm text-destructive">{status.error}</p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3">
        {status.response_time_ms != null && (
          <span className="text-sm text-muted-foreground">
            {status.response_time_ms.toFixed(1)}ms
          </span>
        )}
        {status.workers !== undefined && (
          <span className="text-sm text-muted-foreground">
            {status.workers} {status.workers === 1 ? "worker" : "workers"}
          </span>
        )}
        <StatusBadge
          status={status.status}
          label={
            status.status === "healthy"
              ? "Online"
              : status.status === "offline"
                ? "Offline"
                : status.status === "degraded"
                  ? "Degraded"
                  : "Unknown"
          }
        />
      </div>
    </div>
  );
}

export function SystemHealthPanel() {
  const { data, isLoading, error } = useSystemHealth();

  if (isLoading) {
    return (
      <SectionCard title="Service Health">
        <p className="text-sm text-muted-foreground">
          Loading system status...
        </p>
      </SectionCard>
    );
  }

  if (error) {
    return (
      <SectionCard title="Service Health">
        <p className="text-sm text-destructive">Failed to load system health</p>
      </SectionCard>
    );
  }

  if (!data) return null;

  return (
    <SectionCard title="Service Health">
      <p className="text-sm text-muted-foreground mb-4">
        Real-time system status (auto-refreshes every 10 seconds)
      </p>
      <div className="space-y-1">
        <ServiceItem
          name="Backend API"
          status={data.services.backend}
          icon={<Server className="h-4 w-4" />}
        />
        <ServiceItem
          name="PostgreSQL"
          status={data.services.database}
          icon={<Database className="h-4 w-4" />}
        />
        <ServiceItem
          name="Redis"
          status={data.services.redis}
          icon={<HardDrive className="h-4 w-4" />}
        />
        <ServiceItem
          name="Celery Workers"
          status={data.services.celery}
          icon={<Activity className="h-4 w-4" />}
        />
      </div>
    </SectionCard>
  );
}
