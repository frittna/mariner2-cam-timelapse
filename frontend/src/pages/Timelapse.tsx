import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Film, Loader2, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { useTemperatureUnit } from "@/hooks/use-temperature-unit";
import { api } from "@/lib/api";
import { applyTheme, getStoredThemeId, themes } from "@/lib/themes";
import {
  formatTemperature,
  getTemperatureColorClass,
  type TemperatureUnit,
} from "@/lib/temperature";
import { cn } from "@/lib/utils";

const RENDER_PRESETS = [
  { value: "smooth_60fps", label: "60 fps" },
  { value: "normal_30fps", label: "30 fps" },
  { value: "cinematic_25fps", label: "25 fps" },
] as const;

const unitOptions: Array<{ value: TemperatureUnit; label: string }> = [
  { value: "C", label: "Celsius" },
  { value: "F", label: "Fahrenheit" },
];

const tempBands = [
  { label: "Cool", range: "Below 20 C", sample: 18 },
  { label: "Normal", range: "20-35 C", sample: 25 },
  { label: "Hot", range: "35-40 C", sample: 36 },
  { label: "Alert", range: "Above 40 C", sample: 43 },
];

type RenderPreset = (typeof RENDER_PRESETS)[number]["value"];

export default function Timelapse() {
  const queryClient = useQueryClient();
  const { unit, setUnit } = useTemperatureUnit();
  const [activeThemeId, setActiveThemeId] = useState(getStoredThemeId);
  const [keepSessionById, setKeepSessionById] = useState<Record<string, boolean>>({});
  const [activeRenderKey, setActiveRenderKey] = useState<string | null>(null);

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

  const { data: sessions = [], isLoading: sessionsLoading } = useQuery({
    queryKey: ["timelapse-sessions"],
    queryFn: api.timelapseListSessions,
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
      toast.success("Camera profile updated live.");
      queryClient.invalidateQueries({ queryKey: ["timelapse-profiles"] });
      queryClient.invalidateQueries({ queryKey: ["timelapse-status"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const startSessionMutation = useMutation({
    mutationFn: () => api.timelapseStartSession(),
    onSuccess: () => {
      toast.success("Timelapse started.");
      queryClient.invalidateQueries({ queryKey: ["timelapse-status"] });
      queryClient.invalidateQueries({ queryKey: ["timelapse-sessions"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const endSessionMutation = useMutation({
    mutationFn: () => api.timelapseEndSession(),
    onSuccess: () => {
      toast.success("Timelapse stopped.");
      queryClient.invalidateQueries({ queryKey: ["timelapse-status"] });
      queryClient.invalidateQueries({ queryKey: ["timelapse-videos"] });
      queryClient.invalidateQueries({ queryKey: ["timelapse-sessions"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const captureMutation = useMutation({
    mutationFn: () => api.timelapseCapture(),
    onSuccess: () => {
      toast.success("Test frame queued.");
      queryClient.invalidateQueries({ queryKey: ["timelapse-status"] });
      queryClient.invalidateQueries({ queryKey: ["timelapse-sessions"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const triggerTestMutation = useMutation({
    mutationFn: () => api.timelapseTestTrigger(),
    onSuccess: (result) => {
      toast.success(
        result.capture_queued
          ? "Z trigger detected. One frame was queued."
          : "Z trigger detected, but no session is active.",
      );
      queryClient.invalidateQueries({ queryKey: ["timelapse-status"] });
      queryClient.invalidateQueries({ queryKey: ["timelapse-sessions"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const setDetectorInvertMutation = useMutation({
    mutationFn: (invert: boolean) => api.timelapseSetDetectorInvert(invert),
    onSuccess: () => {
      toast.success("Z direction updated.");
      queryClient.invalidateQueries({ queryKey: ["timelapse-status"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const renderSessionMutation = useMutation({
    mutationFn: ({ sessionId, preset, keepSession }: { sessionId: string; preset: RenderPreset; keepSession: boolean }) =>
      api.timelapseRender(sessionId, preset, { keepSession }),
    onSuccess: (_, vars) => {
      toast.success(
        vars.keepSession
          ? "Rendered. Session kept."
          : "Rendered. Session converted to video.",
      );
      queryClient.invalidateQueries({ queryKey: ["timelapse-videos"] });
      queryClient.invalidateQueries({ queryKey: ["timelapse-disk"] });
      queryClient.invalidateQueries({ queryKey: ["timelapse-sessions"] });
      setActiveRenderKey(null);
    },
    onError: (err: Error) => {
      setActiveRenderKey(null);
      toast.error(err.message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (filename: string) => api.timelapseDeleteVideo(filename),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["timelapse-videos"] });
      queryClient.invalidateQueries({ queryKey: ["timelapse-disk"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const profile = profileData?.active ?? "HIGH";
  const detector = status?.detector;
  const profileDetails = profileData?.profiles;
  const mutationPending =
    startSessionMutation.isPending ||
    endSessionMutation.isPending ||
    captureMutation.isPending ||
    triggerTestMutation.isPending ||
    setDetectorInvertMutation.isPending;

  const anySession = sessions.length > 0;

  function formatSensorState(value: boolean | undefined) {
    if (value === undefined) return "n/a";
    return value ? "HIGH" : "LOW";
  }

  function toggleKeepSession(sessionId: string) {
    setKeepSessionById((prev) => ({ ...prev, [sessionId]: !prev[sessionId] }));
  }

  function renderSession(sessionId: string, preset: RenderPreset) {
    const keep = Boolean(keepSessionById[sessionId]);
    setActiveRenderKey(`${sessionId}:${preset}`);
    renderSessionMutation.mutate({ sessionId, preset, keepSession: keep });
  }

  const itemsLoading = sessionsLoading || videosLoading;

  const listRows = useMemo(() => {
    const sessionRows = sessions.map((s) => ({ type: "session" as const, data: s }));
    const videoRows = videos.map((v) => ({ type: "video" as const, data: v }));
    return [...sessionRows, ...videoRows];
  }, [sessions, videos]);

  useEffect(() => {
    applyTheme(activeThemeId);
  }, [activeThemeId]);

  const tempC = bmp280?.ok ? bmp280.temp_c : null;

  return (
    <div className="container pt-2 pb-2 space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Camera, timelapse, rendering, and sensor controls in one place.
        </p>
      </div>

      <div className="rounded-lg border bg-card p-4 space-y-4">
        <div>
          <div className="text-sm font-medium">Global Camera Settings</div>
          <p className="text-xs text-muted-foreground">
            The selected profile is applied live through the MediaMTX API.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(["HIGH", "MID", "LOW"] as const).map((currentProfile) => {
            const details = profileDetails?.[currentProfile];
            const text = details
              ? `${details.resolution} | ${details.bitrate} | ${details.fps} fps`
              : "...";

            return (
              <Button
                key={currentProfile}
                size="sm"
                variant={profile === currentProfile ? "default" : "outline"}
                onClick={() => setProfileMutation.mutate(currentProfile)}
                disabled={setProfileMutation.isPending}
                className="h-auto py-2"
              >
                <span className="flex flex-col items-start leading-tight">
                  <span>{currentProfile}</span>
                  <span className="text-[10px] opacity-80">{text}</span>
                </span>
              </Button>
            );
          })}
        </div>
        <div className="text-sm">
          <span className="font-medium">Selected:</span> {profile}
        </div>
        <div className="text-xs text-muted-foreground">
          Stream: {profileData?.stream_path ?? "cam"} | {profileData?.note}
        </div>
      </div>

      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="text-sm">
          <span className="font-medium">Status:</span>{" "}
          {status?.recording ? "Recording" : "Idle"} |{" "}
          <span className="font-medium">Z detector:</span>{" "}
          {status?.z_detector_running ? "active" : "inactive"} |{" "}
          <span className="font-medium">Frames:</span> {status?.frame_count ?? 0} |{" "}
          <span className="font-medium">Queue:</span> {status?.pending_frames ?? 0}
        </div>
        <div className="text-sm">
          <span className="font-medium">Session:</span> {status?.session_id ?? "none"}
          {status?.last_session_id ? ` | Last session: ${status.last_session_id}` : ""}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={() => startSessionMutation.mutate()}
            disabled={Boolean(status?.recording) || mutationPending}
          >
            Start
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => endSessionMutation.mutate()}
            disabled={!status?.recording || mutationPending}
          >
            Stop
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => captureMutation.mutate()}
            disabled={!status?.recording || mutationPending}
          >
            Test frame
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => triggerTestMutation.mutate()}
            disabled={mutationPending}
          >
            Test Z trigger
          </Button>
        </div>
        <div className="text-xs text-muted-foreground">
          Start opens a capture session. Each detected Z-top should queue one frame.
        </div>
      </div>

      <div className="rounded-lg border bg-card">
        {itemsLoading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        ) : listRows.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            <Film className="mx-auto mb-2 h-8 w-8 opacity-40" />
            No sessions or timelapse videos yet.
          </div>
        ) : (
          <div className="divide-y">
            {listRows.map((row) => {
              if (row.type === "session") {
                const session = row.data;
                const keep = Boolean(keepSessionById[session.session_id]);
                return (
                  <div key={`session-${session.session_id}`} className="p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate font-mono text-sm">
                          Session: {session.session_id}{session.active ? " (active)" : ""}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {session.frame_count} frames
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => toggleKeepSession(session.session_id)}
                        className={cn(
                          "inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs transition-colors",
                          keep
                            ? "border-primary/40 bg-primary/10 text-primary"
                            : "border-border bg-background text-muted-foreground",
                        )}
                        aria-pressed={keep}
                      >
                        <span>Keep session</span>
                        <span
                          className={cn(
                            "relative h-5 w-9 rounded-full transition-colors",
                            keep ? "bg-primary" : "bg-muted",
                          )}
                        >
                          <span
                            className={cn(
                              "absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform",
                              keep ? "translate-x-4" : "translate-x-0",
                            )}
                          />
                        </span>
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {RENDER_PRESETS.map((preset) => {
                        const key = `${session.session_id}:${preset.value}`;
                        const isActive = activeRenderKey === key && renderSessionMutation.isPending;
                        return (
                          <button
                            key={preset.value}
                            type="button"
                            onClick={() => renderSession(session.session_id, preset.value)}
                            disabled={renderSessionMutation.isPending}
                            className={cn(
                              "rounded-md border px-3 py-1.5 text-xs transition-colors",
                              "border-border bg-muted text-foreground",
                              "hover:border-primary hover:bg-primary/10",
                              isActive && "bg-muted-foreground/20 text-foreground",
                              renderSessionMutation.isPending && !isActive && "opacity-70",
                            )}
                          >
                            Render {preset.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              }

              const video = row.data;
              return (
                <div key={`video-${video.filename}`} className="flex items-center justify-between p-3">
                  <div className="min-w-0">
                    <div className="truncate font-mono text-sm">{video.filename}</div>
                    <div className="text-xs text-muted-foreground">{video.size_mb} MB</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        window.open(
                          `/api/timelapse/videos/${encodeURIComponent(video.filename)}`,
                          "_blank",
                        )
                      }
                    >
                      Open
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        window.open(
                          `/api/timelapse/videos/${encodeURIComponent(video.filename)}?download=1`,
                          "_blank",
                        )
                      }
                    >
                      Download
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
              );
            })}
          </div>
        )}
      </div>

      {!anySession ? (
        <div className="text-xs text-muted-foreground px-1">
          No closed sessions available, so no render buttons are shown.
        </div>
      ) : null}

      <div className="rounded-lg border bg-card p-4 space-y-4">
        <div className="text-sm font-medium">Sensors</div>
        <div className="text-sm">
          <span className="font-medium">BMP280:</span>{" "}
          <span className={cn(getTemperatureColorClass(tempC))}>
            {bmp280?.ok
              ? formatTemperature(tempC, unit)
              : `n/a${bmp280?.error ? ` (${bmp280.error})` : ""}`}
          </span>
        </div>
        <div className="text-sm">
          <span className="font-medium">CNY70 A/B:</span>{" "}
          {detector
            ? `${formatSensorState(detector.sensor_a)} / ${formatSensorState(detector.sensor_b)}`
            : "n/a"}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">Top detections:</span> {detector?.top_event_count ?? 0}
          {detector?.last_top_detected_at
            ? ` | Last: ${new Date(detector.last_top_detected_at).toLocaleString()}`
            : ""}
          {detector?.last_event_simulated ? " | last event was a test trigger" : ""}
          <button
            type="button"
            onClick={() => setDetectorInvertMutation.mutate(!(detector?.invert ?? false))}
            disabled={setDetectorInvertMutation.isPending}
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs transition-colors",
              detector?.invert
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border bg-background text-muted-foreground",
            )}
            aria-pressed={detector?.invert ?? false}
          >
            <span>Invert</span>
            <span
              className={cn(
                "relative h-5 w-9 rounded-full transition-colors",
                detector?.invert ? "bg-primary" : "bg-muted",
              )}
            >
              <span
                className={cn(
                  "absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform",
                  detector?.invert ? "translate-x-4" : "translate-x-0",
                )}
              />
            </span>
          </button>
        </div>
        <div className="text-xs text-muted-foreground">
          These values are for validating the two CNY70 sensors and the Z trigger logic. Use Invert when top and bottom are swapped.
        </div>

        <div className="border-t border-border/60 pt-4 space-y-3">
          <div>
            <div className="text-sm font-medium">Temperature Display</div>
            <p className="text-xs text-muted-foreground">
              Choose how temperatures are shown in the navbar and sensor readout.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {unitOptions.map((option) => (
              <Button
                key={option.value}
                size="sm"
                variant={unit === option.value ? "default" : "outline"}
                onClick={() => setUnit(option.value)}
              >
                {option.label}
              </Button>
            ))}
          </div>
          <div className="text-sm text-muted-foreground">
            Preview: <span className="font-medium text-foreground">{formatTemperature(24.5, unit)}</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {tempBands.map((band) => (
              <div key={band.label} className="rounded-md border border-border/60 bg-background/40 p-3">
                <div className={cn("text-sm font-semibold", getTemperatureColorClass(band.sample))}>
                  {band.label}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{band.range}</div>
                <div className={cn("mt-2 text-sm", getTemperatureColorClass(band.sample))}>
                  {formatTemperature(band.sample, unit)}
                </div>
              </div>
            ))}
          </div>

          <div className="border-t border-border/60 pt-4 space-y-3">
            <div>
              <div className="text-sm font-medium">UI colors</div>
              <p className="text-xs text-muted-foreground">
                Customize the accent colors for the UI elements.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {themes.map((theme) => (
                <button
                  key={theme.id}
                  type="button"
                  onClick={() => setActiveThemeId(theme.id)}
                  className={cn(
                    "h-9 w-9 rounded-full border transition-colors",
                    activeThemeId === theme.id
                      ? "border-primary ring-2 ring-primary/30"
                      : "border-border/60 hover:border-border",
                  )}
                  style={{ backgroundColor: theme.accent }}
                  aria-label={`Select color ${theme.id}`}
                  aria-pressed={activeThemeId === theme.id}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
