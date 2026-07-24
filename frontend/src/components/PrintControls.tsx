import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Pause, Play, X } from "lucide-react";
import type { PrinterStatus } from "@/lib/api";

interface PrintControlsProps {
  status: PrinterStatus;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  pendingAction?: "start_print" | "pause_print" | "resume_print" | "cancel_print" | null;
}

export function PrintControls({
  status,
  onPause,
  onResume,
  onCancel,
  pendingAction = null,
}: PrintControlsProps) {
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const canCancel = status === "printing" || status === "paused";

  useEffect(() => {
    if (!canCancel || pendingAction !== null) {
      setConfirmingCancel(false);
    }
  }, [canCancel, pendingAction]);

  const handleCancelClick = () => {
    if (confirmingCancel) {
      setConfirmingCancel(false);
      onCancel();
      return;
    }
    setConfirmingCancel(true);
  };

  return (
    <div className="flex items-center justify-center gap-3">
      {status === "printing" ? (
        <Button
          onClick={onPause}
          variant="secondary"
          size="lg"
          className="gap-2"
          disabled={pendingAction !== null}
        >
          {pendingAction === "pause_print" ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Pausing...
            </>
          ) : (
            <>
              <Pause className="h-4 w-4" />
              Pause
            </>
          )}
        </Button>
      ) : status === "paused" ? (
        <Button
          onClick={onResume}
          size="lg"
          className="gap-2"
          disabled={pendingAction !== null}
        >
          {pendingAction === "resume_print" ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Resuming...
            </>
          ) : (
            <>
              <Play className="h-4 w-4" />
              Resume
            </>
          )}
        </Button>
      ) : null}

      {canCancel && (
        <Button
          onClick={handleCancelClick}
          variant="destructive"
          size="lg"
          className="gap-2"
          disabled={pendingAction !== null}
        >
          {pendingAction === "cancel_print" ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Canceling...
            </>
          ) : (
            <>
              <X className="h-4 w-4" />
              {confirmingCancel ? "Confirm Cancel?" : "Cancel"}
            </>
          )}
        </Button>
      )}
    </div>
  );
}
