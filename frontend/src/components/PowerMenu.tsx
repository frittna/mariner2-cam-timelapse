import { useState } from "react";
import { Power, PowerOff, RotateCcw, RefreshCw } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

export function PowerMenu() {
  const [confirming, setConfirming] = useState<"shutdown" | "reboot" | "restart_service" | null>(
    null,
  );
  const [open, setOpen] = useState(false);

  function reset() {
    setConfirming(null);
  }

  async function handleAction(action: "shutdown" | "reboot" | "restart_service") {
    if (confirming !== action) {
      setConfirming(action);
      return;
    }
    try {
      if (action === "shutdown") {
        await api.hostShutdown();
      } else if (action === "reboot") {
        await api.hostReboot();
      } else if (action === "restart_service") {
        await api.hostRestartService();
      }
    } catch {
      // host is shutting down, connection will drop
    }
    setOpen(false);
    reset();
  }

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      <PopoverTrigger asChild>
        <button
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Power menu"
        >
          <Power className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-48 p-2">
        <p className="mb-2 px-2 text-xs font-medium text-muted-foreground">
          Host Power
        </p>
        <div className="space-y-0.5">
          {/* Mariner Restart Button */}
          <button
            onClick={() => handleAction("restart_service")}
            className={cn(
              "flex w-full items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors",
              confirming === "restart_service"
                ? "bg-destructive/10 font-medium text-destructive"
                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
            )}
          >
            <RefreshCw className="h-4 w-4" />
            {confirming === "restart_service" ? "Confirm Restart?" : "Restart Mariner"}
          </button>

          <button
            onClick={() => handleAction("reboot")}
            className={cn(
              "flex w-full items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors",
              confirming === "reboot"
                ? "bg-destructive/10 font-medium text-destructive"
                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
            )}
          >
            <RotateCcw className="h-4 w-4" />
            {confirming === "reboot" ? "Confirm Reboot?" : "Reboot"}
          </button>
          
          <button
            onClick={() => handleAction("shutdown")}
            className={cn(
              "flex w-full items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors",
              confirming === "shutdown"
                ? "bg-destructive/10 font-medium text-destructive"
                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
            )}
          >
            <PowerOff className="h-4 w-4" />
            {confirming === "shutdown" ? "Confirm Shutdown?" : "Shut Down"}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
