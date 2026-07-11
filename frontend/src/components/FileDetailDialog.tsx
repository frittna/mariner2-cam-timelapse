import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Play, Layers, Clock, Ruler, Trash2 } from "lucide-react";
import { api, formatTime, type FileEntry } from "@/lib/api";
import { cn } from "@/lib/utils";

interface FileDetailDialogProps {
  file: FileEntry | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const AUTO_TIMELAPSE_KEY = "mariner_auto_timelapse_on_start";
const AUTO_TIMELAPSE_EVENT = "mariner:auto-timelapse-changed";

export function FileDetailDialog({
  file,
  open,
  onOpenChange,
}: FileDetailDialogProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [autoTimelapse, setAutoTimelapse] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(AUTO_TIMELAPSE_KEY) === "1";
  });


  useEffect(() => {
    if (!confirmDelete) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-confirm-delete='file']")) {
        return;
      }
      setConfirmDelete(false);
    };

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [confirmDelete]);

  const { data: details } = useQuery({
    queryKey: ["fileDetails", file?.path],
    queryFn: () => api.fileDetails(file!.path),
    enabled: !!file?.can_be_printed && open,
  });

  if (!file) return null;

  const setAuto = (value: boolean) => {
    setAutoTimelapse(value);
    if (typeof window !== "undefined") {
      localStorage.setItem(AUTO_TIMELAPSE_KEY, value ? "1" : "0");
      window.dispatchEvent(new Event(AUTO_TIMELAPSE_EVENT));
    }
  };

  const handlePrint = async () => {
    if (typeof window !== "undefined") {
      localStorage.setItem(AUTO_TIMELAPSE_KEY, autoTimelapse ? "1" : "0");
      window.dispatchEvent(new Event(AUTO_TIMELAPSE_EVENT));
    }
    if (autoTimelapse) {
      try {
        const stem = (file.filename || "print")
          .replace(/\.[^.]+$/, "")
          .replace(/[^a-zA-Z0-9._-]/g, "_");
        const ts = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*$/, "").replace("T", "_");
        await api.timelapseStartSession(`${stem}_${ts}`);
      } catch {
        // Ignore when an active session already exists.
      }
    }
    await api.printerCommand("start_print", file.path);
    onOpenChange(false);
    navigate("/");
  };

  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    await api.deleteFile(file.path);
    onOpenChange(false);
    setConfirmDelete(false);
    queryClient.invalidateQueries({ queryKey: ["files"] });
  };

  const resetState = (nextOpen: boolean) => {
    if (!nextOpen) {
      setConfirmDelete(false);
    }
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={resetState}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="break-all font-mono text-base">
            {file.filename}
          </DialogTitle>
          <DialogDescription>
            {file.can_be_printed ? "Printable file details" : "File details"}
          </DialogDescription>
        </DialogHeader>

        {file.can_be_printed && (
          <>
            <div className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-md border bg-muted">
              <img
                src={api.filePreviewUrl(file.path)}
                alt="Layer preview"
                className="h-full w-full object-contain"
                onError={(e) => {
                  const el = e.target as HTMLImageElement;
                  el.style.display = "none";
                }}
              />
            </div>

            {details && (
              <div className="grid grid-cols-3 gap-3">
                <MetaItem
                  icon={Layers}
                  label="Layers"
                  value={`${details.layer_count}`}
                />
                <MetaItem
                  icon={Clock}
                  label="Est. Time"
                  value={formatTime(details.print_time_secs)}
                />
                <MetaItem
                  icon={Ruler}
                  label="Height"
                  value={`${details.height_mm || (details.layer_height_mm * details.layer_count).toFixed(1)}mm`}
                />
              </div>
            )}
          </>
        )}

        {file.can_be_printed && (
          <div className="flex items-center justify-end gap-2 text-xs">
            <span className="text-muted-foreground">Auto Timelapse</span>
            <button
              type="button"
              onClick={() => setAuto(!autoTimelapse)}
              className={cn(
                "inline-flex items-center gap-2 rounded-full border px-2.5 py-1 transition-colors",
                autoTimelapse
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border bg-background text-muted-foreground",
              )}
              aria-pressed={autoTimelapse}
            >
              <span>{autoTimelapse ? "ON" : "OFF"}</span>
              <span
                className={cn(
                  "relative h-5 w-9 rounded-full transition-colors",
                  autoTimelapse ? "bg-primary" : "bg-muted",
                )}
              >
                <span
                  className={cn(
                    "absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform",
                    autoTimelapse ? "translate-x-4" : "translate-x-0",
                  )}
                />
              </span>
            </button>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant={confirmDelete ? "destructive" : "ghost"}
            className="gap-2 text-muted-foreground"
            onClick={handleDelete}
            data-confirm-delete="file"
          >
            <Trash2 className="h-4 w-4" />
            {confirmDelete ? "Confirm Delete?" : "Delete"}
          </Button>
          {file.can_be_printed && (
            <Button className="gap-2" onClick={handlePrint}>
              <Play className="h-4 w-4" />
              Start Print
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MetaItem({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md border bg-card p-2 text-center">
      <Icon className="mx-auto h-4 w-4 text-muted-foreground" />
      <p className="mt-1 text-[10px] text-muted-foreground">{label}</p>
      <p className="font-mono text-sm font-medium">{value}</p>
    </div>
  );
}
