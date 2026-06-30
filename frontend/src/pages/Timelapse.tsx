import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Film, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/api";

const RENDER_PRESETS = [
  { value: "smooth_60fps", label: "60fps" },
  { value: "normal_30fps", label: "30fps" },
  { value: "cinematic_25fps", label: "25fps" },
] as const;

export default function Timelapse() {
  const queryClient = useQueryClient();

  const { data: status } = useQuery({
    queryKey: ["timelapse-status"],
    queryFn: api.timelapseStatus,
    refetchInterval: 3000,
  });

  const { data: profileData } = useQuery({
    queryKey: ["timelapse-profiles"],
    queryFn: api.timelapseProfiles,
    refetchInterval: 5000,
  });

  const { data: videos = [], isLoading: videosLoading } = useQuery({
    queryKey: ["timelapse-videos"],
    queryFn: api.timelapseListVideos,
    refetchInterval: 5000,
  });

  const { data: disk } = useQuery({
    queryKey: ["timelapse-disk"],
    queryFn: api.timelapseDiskSpace,
    refetchInterval: 15000,
  });

  const { data: bmp280 } = useQuery({
    queryKey: ["bmp280"],
    queryFn: api.bmp280Temperature,
    refetchInterval: 30000,
  });

  const setProfileMutation = useMutation({
    mutationFn: (profile: "HIGH" | "MID" | "LOW") => api.timelapseSetProfile(profile),
    onSuccess: () => {
      toast.success("Kameraprofil gespeichert. MediaMTX und Mariner bitte neu starten.");
      queryClient.invalidateQueries({ queryKey: ["timelapse-profiles"] });
      queryClient.invalidateQueries({ queryKey: ["timelapse-status"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const startSessionMutation = useMutation({
    mutationFn: () => api.timelapseStartSession(),
    onSuccess: () => {
      toast.success("Timelapse aktiviert");
      queryClient.invalidateQueries({ queryKey: ["timelapse-status"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const endSessionMutation = useMutation({
    mutationFn: () => api.timelapseEndSession(),
    onSuccess: () => {
      toast.success("Timelapse deaktiviert");
      queryClient.invalidateQueries({ queryKey: ["timelapse-status"] });
      queryClient.invalidateQueries({ queryKey: ["timelapse-videos"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const captureMutation = useMutation({
    mutationFn: () => api.timelapseCapture(),
    onSuccess: () => {
      toast.success("Testfoto ausgelost");
      queryClient.invalidateQueries({ queryKey: ["timelapse-status"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const triggerTestMutation = useMutation({
    mutationFn: () => api.timelapseTestTrigger(),
    onSuccess: (result) => {
      toast.success(
        result.capture_queued
          ? "Z-Testtrigger erkannt, Frame wurde ausgelost"
          : "Z-Testtrigger erkannt, aber keine aktive Session",
      );
      queryClient.invalidateQueries({ queryKey: ["timelapse-status"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const profile = profileData?.active ?? "HIGH";
  const detector = status?.detector;
  const renderSessionId = status?.session_id ?? status?.last_session_id;
  const mutationPending =
    startSessionMutation.isPending ||
    endSessionMutation.isPending ||
    captureMutation.isPending ||
    triggerTestMutation.isPending;

  const renderMutation = useMutation({
    mutationFn: (preset: "smooth_60fps" | "normal_30fps" | "cinematic_25fps") => {
      if (!renderSessionId) throw new Error("Keine Session-ID verfugbar");
      return api.timelapseRender(renderSessionId, preset);
    },
    onSuccess: () => {
      toast.success("Timelapse gerendert");
      queryClient.invalidateQueries({ queryKey: ["timelapse-videos"] });
      queryClient.invalidateQueries({ queryKey: ["timelapse-disk"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (filename: string) => api.timelapseDeleteVideo(filename),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["timelapse-videos"] });
      queryClient.invalidateQueries({ queryKey: ["timelapse-disk"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function formatSensorState(value: boolean | undefined) {
    if (value === undefined) return "n/a";
    return value ? "HIGH" : "LOW";
  }

  return (
    <div className="container pt-2 pb-2 space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Timelapse</h1>
        <p className="text-sm text-muted-foreground">
          Isolierte Timelapse-Steuerung mit Z-Trigger, globalem cam-Profil und Video-Rendering
        </p>
      </div>

      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="text-sm">
          <span className="font-medium">Status:</span>{" "}
          {status?.recording ? "Recording" : "Idle"} |{" "}
          <span className="font-medium">Z-Detector:</span>{" "}
          {status?.z_detector_running ? "active" : "inactive"} |{" "}
          <span className="font-medium">Frames:</span> {status?.frame_count ?? 0}
        </div>
        <div className="text-sm">
          <span className="font-medium">Session:</span> {status?.session_id ?? "none"}
          {status?.last_session_id ? ` | Letzte Session: ${status.last_session_id}` : ""}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={() => startSessionMutation.mutate()}
            disabled={Boolean(status?.recording) || mutationPending}
          >
            Aktivieren
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => endSessionMutation.mutate()}
            disabled={!status?.recording || mutationPending}
          >
            Deaktivieren
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => captureMutation.mutate()}
            disabled={!status?.recording || mutationPending}
          >
            Testfoto
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => triggerTestMutation.mutate()}
            disabled={mutationPending}
          >
            Z-Testtrigger
          </Button>
        </div>
        <div className="text-xs text-muted-foreground">
          Aktivieren startet die Session. Danach lost jede erkannte Z-Top-Position automatisch ein Frame aus.
        </div>
      </div>

      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="text-sm font-medium">Globale Kameraqualitaet (cam)</div>
        <div className="flex items-center gap-2">
          {(["HIGH", "MID", "LOW"] as const).map((p) => (
            <Button
              key={p}
              size="sm"
              variant={profile === p ? "default" : "outline"}
              onClick={() => setProfileMutation.mutate(p)}
              disabled={setProfileMutation.isPending}
            >
              {p}
            </Button>
          ))}
        </div>
        <div className="text-sm">
          <span className="font-medium">Aktiv markiert:</span> {profile}
          {profileData?.restart_required ? " | Neustart ausstehend" : " | Kein Neustart offen"}
        </div>
        <div className="text-xs text-muted-foreground">
          Stream: {profileData?.stream_path ?? "cam"} | {profileData?.note}
        </div>
      </div>

      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="text-sm font-medium">Sensoren</div>
        <div className="text-sm">
          <span className="font-medium">BMP280:</span>{" "}
          {bmp280?.ok ? `${bmp280.temp_c?.toFixed(1)} °C` : `n/a${bmp280?.error ? ` (${bmp280.error})` : ""}`}
        </div>
        <div className="text-sm">
          <span className="font-medium">CNY70 A/B:</span>{" "}
          {detector ? `${formatSensorState(detector.sensor_a)} / ${formatSensorState(detector.sensor_b)}` : "n/a"}
        </div>
        <div className="text-sm">
          <span className="font-medium">Top-Erkennungen:</span> {detector?.top_event_count ?? 0}
          {detector?.last_top_detected_at
            ? ` | Letzte: ${new Date(detector.last_top_detected_at).toLocaleString()}`
            : ""}
          {detector?.last_event_simulated ? " | letzte Erkennung war Testtrigger" : ""}
        </div>
        <div className="text-xs text-muted-foreground">
          Die Sensorwerte dienen nur zum Testen der zwei CNY70 und der Z-Richtungs-Erkennung im Timelapse-Fenster.
        </div>
      </div>

      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="text-sm font-medium">Video Rendering</div>
        <div className="flex flex-wrap gap-2">
          {RENDER_PRESETS.map((preset) => (
            <Button
              key={preset.value}
              size="sm"
              onClick={() => renderMutation.mutate(preset.value)}
              disabled={renderMutation.isPending || !renderSessionId}
            >
              {preset.label}
            </Button>
          ))}
        </div>
        <div className="text-xs text-muted-foreground">
          Rendering nutzt die aktive oder zuletzt beendete Session. Die Bildqualitaet kommt vom globalen cam-Stream.
        </div>
        <div className="text-xs text-muted-foreground">
          Disk: {disk ? `${disk.free_gb.toFixed(1)} GB frei` : "..."}
        </div>
      </div>

      <div className="rounded-lg border bg-card">
        {videosLoading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        ) : videos.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            <Film className="mx-auto mb-2 h-8 w-8 opacity-40" />
            Noch keine Timelapse-Videos
          </div>
        ) : (
          <div className="divide-y">
            {videos.map((video) => (
              <div key={video.filename} className="flex items-center justify-between p-3">
                <div className="min-w-0">
                  <div className="truncate font-mono text-sm">{video.filename}</div>
                  <div className="text-xs text-muted-foreground">{video.size_mb} MB</div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => window.open(`/api/timelapse/videos/${encodeURIComponent(video.filename)}`, "_blank")}
                  >
                    Open
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => deleteMutation.mutate(video.filename)}
                    disabled={deleteMutation.isPending}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
