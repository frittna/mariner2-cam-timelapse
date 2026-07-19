import { Progress } from "@/components/ui/progress";
import { formatTime } from "@/lib/api";
import { ellipsizeMiddle } from "@/lib/utils";

export interface PrintJob {
  fileName: string;
  currentLayer: number;
  totalLayers: number;
  progress: number;
  elapsedTime: number;
  remainingTime: number;
  status: string;
}

interface PrintProgressProps {
  job: PrintJob;
}

export function PrintProgress({ job }: PrintProgressProps) {
  return (
    <div className="space-y-6">
      {/* Big percentage */}
      <div className="text-center">
        <span className="font-mono text-6xl font-bold tracking-tight text-primary sm:text-7xl">
          {job.progress.toFixed(1)}%
        </span>
      </div>

      {/* Progress bar */}
      <Progress value={job.progress} className="h-3 bg-muted" />

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatBlock label="Current Layer" value={`${job.currentLayer}`} />
        <StatBlock label="Total Layers" value={`${job.totalLayers}`} />
        <StatBlock label="Elapsed" value={formatTime(job.elapsedTime)} />
        <StatBlock
          label="Remaining / ETA"
          value={`${formatTime(job.remainingTime)} / ${formatEtaClock(job.remainingTime)}`}
        />
      </div>

      {/* File name */}
      <div className="rounded-md bg-muted px-3 py-2 text-center">
        <span className="font-mono text-sm text-muted-foreground" title={job.fileName}>
          {ellipsizeMiddle(job.fileName, 42)}
        </span>
      </div>
    </div>
  );
}

function StatBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-card p-3 text-center">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-mono text-lg font-semibold">{value}</p>
    </div>
  );
}


function formatEtaClock(remainingSeconds: number): string {
  const eta = new Date(Date.now() + Math.max(0, remainingSeconds) * 1000);
  const hours = String(eta.getHours()).padStart(2, "0");
  const minutes = String(eta.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}
