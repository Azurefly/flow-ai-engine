import type { LucideIcon } from "lucide-react";

type MetricTone = "blue" | "emerald" | "red" | "amber" | "slate";

export function WorkspaceMetric({ icon: Icon, label, value, tone, fullWidthOnMobile }: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  tone: MetricTone;
  fullWidthOnMobile?: boolean;
}) {
  return (
    <div className={fullWidthOnMobile ? "workspace-metric col-span-2 sm:col-span-1" : "workspace-metric"} data-tone={tone}>
      <div><span>{label}</span><Icon size={16} aria-hidden="true" /></div>
      <p className="aiflow-type-display min-w-0 break-words font-bold tabular-nums mt-1 sm:mt-2">{value}</p>
    </div>
  );
}
