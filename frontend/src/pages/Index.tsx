import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PrintProgress } from "@/components/PrintProgress";
import { PrintControls } from "@/components/PrintControls";
import { StatusIndicator } from "@/components/StatusIndicator";
import { api, mapPrinterState, type PrinterStatus } from "@/lib/api";
import { ellipsizeMiddle } from "@/lib/utils";
import { WifiOff, CheckCircle2, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useState, useEffect, useRef } from "react";

const AUTO_TIMELAPSE_KEY = "mariner_auto_timelapse_on_start";
const AUTO_TIMELAPSE_EVENT = "mariner:auto-timelapse-changed";
const PRINTER_PENDING_ACTION_KEY = "mariner_printer_pending_action";
const PAUSE_HOLD_MS = 25000;

type PendingPrinterAction =
  | "start_print"
  | "pause_print"
  | "resume_print"
  | "cancel_print"
  | null;

export default function Index() {
  const queryClient = useQueryClient();
  type CamSize = 'MAX' | 'MID' | 'MIN' | 'HIDE';
  const [autoTimelapseEnabled, setAutoTimelapseEnabled] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(AUTO_TIMELAPSE_KEY) === "1";
  });

  const [camSize, setCamSize] = useState<CamSize>(() => {
    if (typeof window !== 'undefined') {
      // Keep a separate camera size per page.
      const saved = localStorage.getItem('mariner_cam_size_index') as CamSize;
      return saved || 'MAX';
    }
    return 'MAX';
  });

  const handleSizeChange = async (size: CamSize) => {
    setCamSize(size);
    if (typeof window !== 'undefined') {
      localStorage.setItem('mariner_cam_size_index', size);
    }

    try {
      const action = size === 'HIDE' ? 'stop' : 'start';
      await fetch(`/api/camera/${action}`, { method: 'POST' });
    } catch (error) {
      console.error("Failed to toggle the camera service:", error);
    }
  };

  const { data, isLoading, error } = useQuery({
    queryKey: ["printStatus"],
    queryFn: () => api.printStatus(),
    refetchInterval: 5000,
  });

  const { data: timelapseStatus } = useQuery({
    queryKey: ["timelapseStatusSummary"],
    queryFn: () => api.timelapseStatus(),
    refetchInterval: 5000,
  });

  const { data: timelapseDisk } = useQuery({
    queryKey: ["timelapseDiskSummary"],
    queryFn: () => api.timelapseDiskSpace(),
    refetchInterval: 30000,
  });

  const status: PrinterStatus = data ? mapPrinterState(data.state) : "offline";
  const prevStatusRef = useRef<PrinterStatus>("offline");
  const idleConfirmCountRef = useRef(0);
  const autoStartArmedRef = useRef(true);

  const [pendingPrinterAction, setPendingPrinterAction] = useState<PendingPrinterAction>(null);
  const [pausePendingUntilMs, setPausePendingUntilMs] = useState(0);

  const persistPendingAction = (action: PendingPrinterAction) => {
    setPendingPrinterAction(action);
    if (typeof window === "undefined") {
      return;
    }
    if (action === null) {
      window.localStorage.removeItem(PRINTER_PENDING_ACTION_KEY);
      return;
    }
    window.localStorage.setItem(
      PRINTER_PENDING_ACTION_KEY,
      JSON.stringify({ action, started_at: Date.now() }),
    );
  };

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["printStatus"] });

  const handlePause = async () => {
    setPausePendingUntilMs(Date.now() + PAUSE_HOLD_MS);
    persistPendingAction("pause_print");
    try {
      await api.printerCommand("pause_print");
    } finally {
      refresh();
    }
  };

  const handleResume = async () => {
    persistPendingAction("resume_print");
    try {
      await api.printerCommand("resume_print");
    } finally {
      refresh();
    }
  };

  const handleCancel = async () => {
    persistPendingAction("cancel_print");
    try {
      await api.printerCommand("cancel_print");
    } finally {
      refresh();
    }
  };


  useEffect(() => {
    const prev = prevStatusRef.current;
    const autoEnabled =
      typeof window !== "undefined" &&
      window.localStorage.getItem(AUTO_TIMELAPSE_KEY) === "1";

    if (autoEnabled && autoStartArmedRef.current && prev !== "printing" && status === "printing") {
      const rawName = data?.selected_file || "auto_print";
      const stem = rawName
        .replace(/\.[^.]+$/, "")
        .replace(/[^a-zA-Z0-9._-]/g, "_");
      const now = new Date();
      const ts = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}--${String(now.getHours()).padStart(2, "0")}-${String(now.getMinutes()).padStart(2, "0")}`;
      api.timelapseStartSession(`${stem}_${ts}`).catch(() => {
        // Ignore: session may already exist.
      });
      autoStartArmedRef.current = false;
    }

    if (status === "idle") autoStartArmedRef.current = true;
    if (autoEnabled && (prev === "printing" || prev === "paused")) {
      if (status === "idle") {
        idleConfirmCountRef.current += 1;
        if (idleConfirmCountRef.current >= 3) {
          api.timelapseEndSession().catch(() => {
            // Ignore: no session or backend unavailable.
          });
          idleConfirmCountRef.current = 0;
        }
      } else if (status === "printing" || status === "paused") {
        idleConfirmCountRef.current = 0;
      } else {
        // Ignore transient offline/unknown states for auto-end decisions.
        idleConfirmCountRef.current = 0;
      }
    } else {
      idleConfirmCountRef.current = 0;
    }

    prevStatusRef.current = status;
  }, [status, data?.selected_file]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const raw = window.localStorage.getItem(PRINTER_PENDING_ACTION_KEY);
    if (!raw) {
      setPendingPrinterAction(null);
      return;
    }

    try {
      const parsed = JSON.parse(raw) as { action?: PendingPrinterAction; started_at?: number };
      const action = parsed.action ?? null;
      const ageMs = Date.now() - (parsed.started_at ?? 0);
      if (!action || ageMs > 120000) {
        persistPendingAction(null);
        return;
      }
      setPendingPrinterAction(action);
    } catch {
      persistPendingAction(null);
    }
  }, []);

  useEffect(() => {
    if (!pendingPrinterAction) {
      return;
    }

    const resolved =
      (pendingPrinterAction === "start_print" && (status === "printing" || status === "paused")) ||
      (pendingPrinterAction === "pause_print" && status === "paused" && Date.now() >= pausePendingUntilMs) ||
      (pendingPrinterAction === "resume_print" && status === "printing") ||
      (pendingPrinterAction === "cancel_print" && (status === "idle" || status === "offline"));

    if (resolved) {
      persistPendingAction(null);
    }
  }, [pendingPrinterAction, status, pausePendingUntilMs]);
  useEffect(() => {
    if (pendingPrinterAction !== "pause_print") {
      return;
    }
    const remainingMs = pausePendingUntilMs - Date.now();
    if (remainingMs <= 0) {
      persistPendingAction(null);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      persistPendingAction(null);
    }, remainingMs);

    return () => window.clearTimeout(timeoutId);
  }, [pendingPrinterAction, pausePendingUntilMs]);
  const printerName =
    document
      .querySelector('meta[name="printer-display-name"]')
      ?.getAttribute("content") || undefined;

  const timelapseSessionLabel = timelapseStatus?.session_id ?? "none";

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const syncAutoTimelapse = () => {
      setAutoTimelapseEnabled(
        window.localStorage.getItem(AUTO_TIMELAPSE_KEY) === "1",
      );
    };

    syncAutoTimelapse();
    window.addEventListener("storage", syncAutoTimelapse);
    window.addEventListener(AUTO_TIMELAPSE_EVENT, syncAutoTimelapse);

    return () => {
      window.removeEventListener("storage", syncAutoTimelapse);
      window.removeEventListener(AUTO_TIMELAPSE_EVENT, syncAutoTimelapse);
    };
  }, []);

  const job = data
    ? {
        fileName: data.selected_file || "",
        currentLayer: data.current_layer ?? 0,
        totalLayers: data.layer_count ?? 0,
        progress: data.progress,
        elapsedTime: data.print_time_secs
          ? data.print_time_secs - (data.time_left_secs ?? 0)
          : 0,
        remainingTime: data.time_left_secs ?? 0,
        status,
      }
    : null;

  return (
    <div className="container pt-2 pb-2">
      <div className="mb-2 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Printer Dashboard
          </h1>
          {printerName && (
            <p className="text-sm text-muted-foreground">{printerName}</p>
          )}
          <p className="text-xs text-muted-foreground">
            Timelapse Session: {timelapseSessionLabel}
            {timelapseDisk ? ` | SD free: ${timelapseDisk.free_gb.toFixed(2)} GB` : ""}
          </p>
        </div>
        <StatusIndicator status={status} />
      </div>
      {pendingPrinterAction && (
        <div className="mb-2 rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-sm text-primary">
          Waiting for printer confirmation: {pendingPrinterAction.replace("_", " ").replace("_", " ")}...
        </div>
      )}

      {/* Live camera stream controls. */}
      <div className="cam-wrapper-container" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '16px', width: '100%' }}>
  
  <div className="cam-control-bar" style={{
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: camSize === 'MAX' ? '1296px' : camSize === 'MID' ? '800px' : camSize === 'MIN' ? '480px' : '100%',
    maxWidth: '100%',
    backgroundColor: '#111',
    padding: '6px 12px',
    borderRadius: camSize === 'HIDE' ? '6px' : '6px 6px 0 0',
    border: '2px solid #222',
    borderBottom: camSize === 'HIDE' ? '2px solid #222' : 'none',
    boxSizing: 'border-box',
    transition: 'width 0.3s ease'
  }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#aaa', fontWeight: 'bold' }}>
      <span id="db-led" style={{ 
        width: '10px', 
        height: '10px', 
        borderRadius: '50%', 
        backgroundColor: camSize === 'HIDE' ? '#64748b' : '#22c55e', 
        display: 'inline-block',
        boxShadow: camSize === 'HIDE' ? 'none' : '0 0 8px #22c55e',
        transition: 'background-color 0.3s'
      }} />
      <span id="db-text">{camSize === 'HIDE' ? 'Camera: Off' : 'Camera: On'}</span>
    </div>

    <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end', alignItems: 'center' }}>
      {(['MAX', 'MID', 'MIN', 'HIDE'] as CamSize[]).map((size) => (
        <button
          key={size}
          onClick={() => handleSizeChange(size)}
          style={{
            padding: '3px 10px',
            fontSize: '10px',
            backgroundColor: camSize === size ? '#2563eb' : '#222',
            color: '#fff',
            border: camSize === size ? '1px solid #60a5fa' : '1px solid #444',
            borderRadius: '4px',
            cursor: 'pointer',
            fontWeight: 'bold',
            letterSpacing: '0.5px',
            transition: 'all 0.2s'
          }}
        >
          {size}
        </button>
      ))}
    </div>
  </div>

  {/* Remove the iframe entirely when the stream is hidden. */}
  {camSize !== 'HIDE' && (
    <div className="cam-frame-container" style={{
      width: camSize === 'MAX' ? '1296px' : camSize === 'MID' ? '800px' : '480px',
      maxWidth: '100%',     
      aspectRatio: '4 / 3', 
      overflow: 'hidden', 
      borderRadius: '0 0 8px 8px',
      border: '2px solid #222',
      boxShadow: '0 4px 10px rgba(0,0,0,0.5)',
      backgroundColor: '#000',
      transition: 'width 0.3s ease'
    }}>
      <iframe 
        src={typeof window !== 'undefined' ? `http://${window.location.hostname}:8889/cam` : ''}
        title="Printer Live View"
        scrolling="no"
        style={{ width: '100%', height: '100%', border: 'none', display: 'block', overflow: 'hidden' }}
      />
    </div>
  )}
</div>


      {/* Status */}
      {isLoading && (
        <div className="flex flex-col items-center justify-center rounded-lg border bg-card px-6 py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="mt-4 text-sm text-muted-foreground">Connecting to printer...</p>
        </div>
      )}

      {error && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-destructive/20 bg-destructive/5 px-6 py-12">
          <WifiOff className="h-8 w-8 text-destructive" />
          <h2 className="mt-4 text-lg font-semibold">Connection Error</h2>
          <p className="mt-1 text-center text-sm text-muted-foreground">Could not reach the printer. Check that the backend is running.</p>
        </div>
      )}

      {!isLoading && !error && (
        <div className="mt-6">
          {(status === "printing" || status === "paused") && job && (
            <div className="space-y-6">
              <div className="rounded-lg border bg-card p-6">
                <PrintProgress job={job} />
              </div>
              <PrintControls
                status={status}
                onPause={handlePause}
                onResume={handleResume}
                onCancel={handleCancel}
                pendingAction={pendingPrinterAction}
              />
            </div>
          )}

          {status === "idle" && (
            <div className="flex flex-col items-center justify-center rounded-lg border bg-card px-6 py-16">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-success/10">
                <CheckCircle2 className="h-8 w-8 text-success" />
              </div>
              <h2 className="mt-4 text-lg font-semibold">Ready to Print</h2>
              <p className="mt-1 text-sm text-muted-foreground">Select a file from the File Manager to start printing.</p>
              <Button asChild className="mt-4">
                <Link to="/files">Open File Manager</Link>
              </Button>
            </div>
          )}

          {status === "offline" && (
            <div className="flex flex-col items-center justify-center rounded-lg border border-destructive/20 bg-destructive/5 px-6 py-16">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
                <WifiOff className="h-8 w-8 text-destructive" />
              </div>
              <h2 className="mt-4 text-lg font-semibold">Printer Offline</h2>
              <p className="mt-1 text-center text-sm text-muted-foreground">Unable to connect. Check USB connection and power.</p>
            </div>
          )}
        </div>
      )}

      {/* Model preview */}
      {!isLoading && !error && (status === "printing" || status === "paused") && job?.fileName && (
        <div className="preview-wrapper-container" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: '24px', marginBottom: '16px', width: '100%' }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            width: '1296px',
            maxWidth: '100%',
            backgroundColor: '#111',
            padding: '6px 12px',
            borderRadius: '6px 6px 0 0',
            border: '2px solid #222',
            borderBottom: 'none',
            boxSizing: 'border-box'
          }}>
            <div style={{ fontSize: '13px', color: '#aaa', fontWeight: 'bold' }}>
              Model-Preview: <span style={{ color: '#00b4d8' }} title={job.fileName}>{ellipsizeMiddle(job.fileName, 56)}</span>
            </div>
          </div>

          <div style={{
            width: '1296px',
            maxWidth: '100%',     
            height: '350px', 
            overflow: 'hidden', 
            borderRadius: '0 0 8px 8px',
            border: '2px solid #222',
            boxShadow: '0 4px 10px rgba(0,0,0,0.5)',
            backgroundColor: '#111',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center'
          }}>
            <img 
              src={api.filePreviewUrl(job.fileName)}
              alt="Layer preview"
              style={{ maxHeight: '100%', maxWidth: '100%', objectFit: 'contain', display: 'block' }}
              onError={(e) => {
                e.currentTarget.style.display = 'none';
                const parent = e.currentTarget.parentElement;
                if (parent) { parent.innerHTML = '<div style="color: #666; font-size: 14px;">No Layer preview available</div>'; }
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}


