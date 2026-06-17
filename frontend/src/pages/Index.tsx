import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PrintProgress } from "@/components/PrintProgress";
import { PrintControls } from "@/components/PrintControls";
import { StatusIndicator } from "@/components/StatusIndicator";
import { api, mapPrinterState, type PrinterStatus } from "@/lib/api";
import { WifiOff, CheckCircle2, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useState, useEffect } from "react";

export default function Index() {
  const queryClient = useQueryClient();
  type CamSize = 'MAX' | 'MID' | 'MIN' | 'HIDE';

  const [camSize, setCamSize] = useState<CamSize>(() => {
    if (typeof window !== 'undefined') {
      // Nutzt ein eigenes Feld nur für das Dashboard
      const saved = localStorage.getItem('mariner_cam_size_index') as CamSize;
      return saved || 'MAX'; // Default beim ersten Mal: MAX
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
      console.error("Fehler beim Umschalten des Kamera-Dienstes im Backend:", error);
    }
  };

  const { data, isLoading, error } = useQuery({
    queryKey: ["printStatus"],
    queryFn: () => api.printStatus(),
    refetchInterval: 5000,
  });

  const status: PrinterStatus = data ? mapPrinterState(data.state) : "offline";

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["printStatus"] });

  const handlePause = async () => {
    await api.printerCommand("pause_print");
    refresh();
  };

  const handleResume = async () => {
    await api.printerCommand("resume_print");
    refresh();
  };

  const handleCancel = async () => {
    await api.printerCommand("cancel_print");
    refresh();
  };

  const printerName =
    document
      .querySelector('meta[name="printer-display-name"]')
      ?.getAttribute("content") || undefined;

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
        </div>
        <StatusIndicator status={status} />
      </div>
      {/* Mariner2 HD Live Video Stream mit 4-Stage Toggle Control (MediaMTX) */}
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
      <span id="db-text">{camSize === 'HIDE' ? 'Cam: DEACTIVATED' : 'Cam: ACTIVE'}</span>
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

  {/* Last-Stopp Logik: Wenn camSize 'HIDE' ist, wird das iframe komplett gelöscht */}
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


      {/* 1. STATUS */}
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

      {/* 2. MODEL-Preview */}
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
              Model-Preview: <span style={{ color: '#00b4d8' }}>{job.fileName}</span>
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
