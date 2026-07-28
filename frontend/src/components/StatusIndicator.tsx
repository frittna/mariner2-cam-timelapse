import { cn } from "@/lib/utils";
import type { PrinterStatus } from "@/lib/api";

const statusConfig: Record<
  PrinterStatus,
  { label: string; dotClass: string; textClass: string }
> = {
  idle: { label: "Ready", dotClass: "bg-green-900 animate-pulse-glow", textClass: "text-white" },
  printing: {
    label: "Printing",
    dotClass: "bg-green-400 animate-pulse-glow",
    textClass: "text-green-500",
  },
  paused: {
    label: "Paused",
    dotClass: "bg-amber-400 animate-pulse-glow",
    textClass: "text-amber-400",
  },
  offline: {
    label: "Offline",
    dotClass: "bg-grey-500",
    textClass: "text-grey-500",
  },
};

export function StatusIndicator({ status }: { status: PrinterStatus }) {
  const config = statusConfig[status];

  return (
    <div className="flex items-center gap-2">
      <div className={cn("h-2.5 w-2.5 rounded-full", config.dotClass)} />
      <span className={cn("font-mono text-sm font-medium", config.textClass)}>
        {config.label}
      </span>
    </div>
  );
}
