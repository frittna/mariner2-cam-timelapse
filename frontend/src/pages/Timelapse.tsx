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
  type TemperatureUnit,
} from "@/lib/temperature";
import { cn, ellipsizeMiddle } from "@/lib/utils";

const RENDER_PRESETS = [
  { value: "smooth_60fps", label: "60 fps" },
  { value: "normal_30fps", label: "30 fps" },
  { value: "cinematic_25fps", label: "25 fps" },
] as const;

const unitOptions: Array<{ value: TemperatureUnit; label: string }> = [
  { value: "C", label: "Celsius" },
  { value: "F", label: "Fahrenheit" },
];

const TEMP_THRESHOLDS_STORAGE_KEY = "mariner_temp_thresholds_c";
const DEFAULT_TEMP_THRESHOLDS_C = {
  coolMax: 20,
  normalMax: 35,
  hotMax: 40,
};

function cToUnit(tempC: number, unit: TemperatureUnit): number {
  return unit === "F" ? (tempC * 9) / 5 + 32 : tempC;
}

function unitToC(value: number, unit: TemperatureUnit): number {
  return unit === "F" ? ((value - 32) * 5) / 9 : value;
}

function normalizeTemperatureThresholds(
  value: Partial<typeof DEFAULT_TEMP_THRESHOLDS_C>,
): typeof DEFAULT_TEMP_THRESHOLDS_C {
  const coolMax = Number.isFinite(value.coolMax)
    ? Number(value.coolMax)
    : DEFAULT_TEMP_THRESHOLDS_C.coolMax;
  const normalRaw = Number.isFinite(value.normalMax)
    ? Number(value.normalMax)
    : DEFAULT_TEMP_THRESHOLDS_C.normalMax;
  const hotRaw = Number.isFinite(value.hotMax)
    ? Number(value.hotMax)
    : DEFAULT_TEMP_THRESHOLDS_C.hotMax;

  const normalMax = Math.max(coolMax + 0.5, normalRaw);
  const hotMax = Math.max(normalMax + 0.5, hotRaw);
  return { coolMax, normalMax, hotMax };
}

function getTemperatureBandColorClass(
  tempC: number | null | undefined,
  thresholds: typeof DEFAULT_TEMP_THRESHOLDS_C,
): string {
  if (tempC == null) return "text-muted-foreground";
  if (tempC < thresholds.coolMax) return "text-blue-400";
  if (tempC < thresholds.normalMax) return "text-green-400";
  if (tempC < thresholds.hotMax) return "text-red-500";
  return "text-pink-400";
}

function formatRangeBoundary(tempC: number, unit: TemperatureUnit): string {
  return `${cToUnit(tempC, unit).toFixed(1)} \u00B0${unit}`;
}

type RenderPreset = (typeof RENDER_PRESETS)[number]["value"];

function buildLocalSessionId(prefix: string = "session"): string {
  const now = new Date();
  const ts = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}--${String(now.getHours()).padStart(2, "0")}-${String(now.getMinutes()).padStart(2, "0")}`;
  return `${prefix}_${ts}`;
}


export default function Timelapse() {
  const queryClient = useQueryClient();
  const { unit, setUnit } = useTemperatureUnit();
  const [activeThemeId, setActiveThemeId] = useState(getStoredThemeId);
  const [keepSessionById, setKeepSessionById] = useState<Record<string, boolean>>({});
  const [activeRenderKey, setActiveRenderKey] = useState<string | null>(null);
  const [confirmDeleteVideo, setConfirmDeleteVideo] = useState<string | null>(null);
  const [confirmDeleteSession, setConfirmDeleteSession] = useState<string | null>(null);
  const [captureOffsetMs, setCaptureOffsetMs] = useState("120");
  const [eventWindowMs, setEventWindowMs] = useState("120");
  const [requestTimeoutMs, setRequestTimeoutMs] = useState("1000");
  const [grabMode, setGrabMode] = useState<"background" | "on_request">("background");
  const [tempThresholdsC, setTempThresholdsC] = useState(() => {
    if (typeof window === "undefined") {
      return DEFAULT_TEMP_THRESHOLDS_C;
    }
    try {
      const raw = window.localStorage.getItem(TEMP_THRESHOLDS_STORAGE_KEY);
      if (!raw) return DEFAULT_TEMP_THRESHOLDS_C;
      return normalizeTemperatureThresholds(JSON.parse(raw));
    } catch {
      return DEFAULT_TEMP_THRESHOLDS_C;
    }
  });

  const { data: status } = useQuery({
    queryKey: ["timelapse-status"],
    queryFn: api.timelapseStatus,
    refetchInterval: 3000,
  });

  const { data: captureSettings } = useQuery({
    queryKey: ["timelapse-capture-settings"],
    queryFn: api.timelapseCaptureSettings,
    refetchInterval: 5000,
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
    mutationFn: () => api.timelapseStartSession(buildLocalSessionId()),
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
          ? "UV trigger detected. One frame was queued."
          : "UV trigger detected, but no session is active.",
      );
      queryClient.invalidateQueries({ queryKey: ["timelapse-status"] });
      queryClient.invalidateQueries({ queryKey: ["timelapse-sessions"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });



  const setCaptureSettingsMutation = useMutation({
    mutationFn: (payload: {
      captureOffsetMs: number;
      eventWindowMs: number;
      requestTimeoutMs: number;
      grabMode: "background" | "on_request";
    }) =>
      api.timelapseSetCaptureSettings({
        capture_offset_ms: payload.captureOffsetMs,
        event_window_ms: payload.eventWindowMs,
        request_timeout_ms: payload.requestTimeoutMs,
        grab_mode: payload.grabMode,
      }),
    onSuccess: () => {
      toast.success("Capture timing updated.");
      queryClient.invalidateQueries({ queryKey: ["timelapse-capture-settings"] });
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


  const deleteSessionMutation = useMutation({
    mutationFn: (sessionId: string) => api.timelapseDeleteSession(sessionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["timelapse-sessions"] });
      setConfirmDeleteSession(null);
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

  const profile = profileData?.active ?? "HIGH";
  const uvDetector = status?.detector_uv;
  const profileDetails = profileData?.profiles;
  const mutationPending =
    startSessionMutation.isPending ||
    endSessionMutation.isPending ||
    captureMutation.isPending ||
    triggerTestMutation.isPending ||
    setCaptureSettingsMutation.isPending;

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

  const tempBands = useMemo(() => {
    const coolMax = tempThresholdsC.coolMax;
    const normalMax = tempThresholdsC.normalMax;
    const hotMax = tempThresholdsC.hotMax;

    return [
      {
        label: "Cool",
        range: `Below ${formatRangeBoundary(coolMax, unit)}`,
        sample: coolMax - 2,
      },
      {
        label: "Normal",
        range: `${formatRangeBoundary(coolMax, unit)} - ${formatRangeBoundary(normalMax, unit)}`,
        sample: (coolMax + normalMax) / 2,
      },
      {
        label: "Hot",
        range: `${formatRangeBoundary(normalMax, unit)} - ${formatRangeBoundary(hotMax, unit)}`,
        sample: (normalMax + hotMax) / 2,
      },
      {
        label: "Alert",
        range: `Above ${formatRangeBoundary(hotMax, unit)}`,
        sample: hotMax + 2,
      },
    ];
  }, [tempThresholdsC, unit]);

  const listRows = useMemo(() => {
    const sessionRows = sessions.map((s) => ({ type: "session" as const, data: s }));
    const videoRows = videos.map((v) => ({ type: "video" as const, data: v }));
    return [...sessionRows, ...videoRows];
  }, [sessions, videos]);

  useEffect(() => {
    applyTheme(activeThemeId);
  }, [activeThemeId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      TEMP_THRESHOLDS_STORAGE_KEY,
      JSON.stringify(tempThresholdsC),
    );
  }, [tempThresholdsC]);

  useEffect(() => {
    if (!captureSettings) {
      return;
    }
    setCaptureOffsetMs(String(captureSettings.capture_offset_ms));
    setEventWindowMs(String(captureSettings.event_window_ms));
    setRequestTimeoutMs(String(captureSettings.request_timeout_ms));
    setGrabMode(captureSettings.grab_mode ?? "background");
  }, [captureSettings]);

  useEffect(() => {
    if (!confirmDeleteSession && !confirmDeleteVideo) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.closest("[data-confirm-delete='session']") ||
        target?.closest("[data-confirm-delete='video']")
      ) {
        return;
      }
      setConfirmDeleteSession(null);
      setConfirmDeleteVideo(null);
    };

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [confirmDeleteSession, confirmDeleteVideo]);

  const tempC = bmp280?.ok ? bmp280.temp_c : null;

  function updateTemperatureThreshold(
    key: keyof typeof DEFAULT_TEMP_THRESHOLDS_C,
    valueInCurrentUnit: string,
  ) {
    const parsed = Number(valueInCurrentUnit);
    if (!Number.isFinite(parsed)) return;
    const valueC = unitToC(parsed, unit);
    setTempThresholdsC((prev) =>
      normalizeTemperatureThresholds({ ...prev, [key]: valueC }),
    );
  }

  function applyCaptureSettings() {
    const parseOr = (value: string, fallback: number) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : fallback;
    };

    setCaptureSettingsMutation.mutate({
      captureOffsetMs: parseOr(captureOffsetMs, 120),
      eventWindowMs: parseOr(eventWindowMs, 120),
      requestTimeoutMs: parseOr(requestTimeoutMs, 1000),
      grabMode,
    });
  }

  function applyGrabMode(nextGrabMode: "background" | "on_request") {
    if (nextGrabMode === grabMode) {
      return;
    }

    const parseOr = (value: string, fallback: number) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : fallback;
    };

    setGrabMode(nextGrabMode);
    setCaptureSettingsMutation.mutate({
      captureOffsetMs: parseOr(captureOffsetMs, 120),
      eventWindowMs: parseOr(eventWindowMs, 120),
      requestTimeoutMs: parseOr(requestTimeoutMs, 1000),
      grabMode: nextGrabMode,
    });
  }

  return (
    <div className="container pt-2 pb-2 space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
      </div>

        <div className="rounded-lg border bg-card p-4 space-y-4">
          <div>
            <div className="text-sm font-medium">UI colors</div>
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

      <div className="rounded-lg border bg-card p-4 space-y-4">
        <div>
          <div className="text-sm font-medium">Camera Settings</div>
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
        <div className="text-sm font-medium">Timelapse Stauts</div>
        <div className="text-sm">
          {status?.recording ? "Recording" : "Idle"} |{" "}
          <span className="font-medium">Frames:</span> {status?.frame_count ?? 0} |{" "}
          <span className="font-medium">Queue:</span> {status?.pending_frames ?? 0} |{" "}
          <span className="font-medium">Request:</span> {status?.capture_requests_total ?? 0} |{" "}
          <span className="font-medium">OK:</span> {status?.capture_success_total ?? 0} |{" "}
          <span className="font-medium">Fail:</span> {status?.capture_fail_total ?? 0} |{" "}
          <span className="font-medium">Last/Avg/Max:</span>{" "}
          {(status?.capture_duration_last_ms ?? 0).toFixed(0)}/{(status?.capture_duration_avg_ms ?? 0).toFixed(0)}/{(status?.capture_duration_max_ms ?? 0).toFixed(0)} ms
        </div>
        <div className="text-sm">
          <span className="font-medium">Session:</span> {status?.session_id ?? "none"}
          {status?.last_session_id ? ` | Last session: ${status.last_session_id}` : ""}
        </div>
        <div className="text-sm">
          <span className="font-medium">UV Light:</span>{" "}
          {uvDetector
            ? `${uvDetector.sensor_high ? "HIGH" : "LOW"} | events: ${uvDetector.event_count}`
            : "n/a"}
          {uvDetector?.last_detected_at
            ? ` | Last: ${new Date(uvDetector.last_detected_at).toLocaleString()}`
            : ""}
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
          variant={status?.recording ? "destructive" : "secondary"}
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
        </div>
        <div className="text-xs text-muted-foreground">
          Press Start to open a new manual capture session. Each detected trigger should queue one frame.
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
                const sessionRendering = Boolean(
                  renderSessionMutation.isPending &&
                  activeRenderKey?.startsWith(`${session.session_id}:`),
                );
                return (
                  <div key={`session-${session.session_id}`} className="p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate font-mono text-sm">
                          Session: {ellipsizeMiddle(session.session_id, 42)}{session.active ? " (active)" : ""}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {session.frame_count} frames
                        </div>
                      </div>

                    </div>
                    <div className="flex flex-wrap items-center gap-2">
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
                        <span>Keep Session</span>
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
                      <button
                        type="button"
                        onClick={() => {
                          if (confirmDeleteSession !== session.session_id) {
                            setConfirmDeleteSession(session.session_id);
                            return;
                          }
                          deleteSessionMutation.mutate(session.session_id);
                        }}
                        disabled={deleteSessionMutation.isPending || session.active}
                        data-confirm-delete="session"
                        className={cn(
                          "rounded-md border px-3 py-1.5 text-xs transition-colors",
                          confirmDeleteSession === session.session_id
                            ? "border-destructive/60 bg-destructive/10 text-destructive"
                            : "border-border bg-muted text-foreground hover:border-primary hover:bg-primary/10",
                          session.active && "opacity-50 cursor-not-allowed",
                        )}
                      >
                        {confirmDeleteSession === session.session_id ? "Delete session?" : "Delete session"}
                      </button>

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
                            {isActive ? (
                              <>
                                <Loader2 className="mr-1 inline-block h-3.5 w-3.5 animate-spin" />
                                Rendering...
                              </>
                            ) : (
                              <>Render {preset.label}</>
                            )}
                          </button>
                        );
                      })}
                    </div>
                    {sessionRendering ? (
                      <div className="text-xs text-primary">Rendering in progress...</div>
                    ) : null}
                  </div>
                );
              }

              const video = row.data;
              return (
                <div key={`video-${video.filename}`} className="flex items-center justify-between p-3">
                  <div className="min-w-0">
                    <div className="truncate font-mono text-sm" title={video.filename}>{ellipsizeMiddle(video.filename, 42)}</div>
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
                      onClick={() => {
                        if (confirmDeleteVideo !== video.filename) {
                          setConfirmDeleteVideo(video.filename);
                          return;
                        }
                        deleteMutation.mutate(video.filename);
                      }}
                      disabled={deleteMutation.isPending}
                      data-confirm-delete="video"
                    >
                      {confirmDeleteVideo === video.filename ? "Delete?" : <Trash2 className="h-3.5 w-3.5" />}
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
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div>
          <div className="text-sm font-medium">Capture Timing</div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="text-xs text-muted-foreground">
            Offset (ms)
            <input
              type="number"
              min={0}
              max={2000}
              step={10}
              value={captureOffsetMs}
              onChange={(e) => setCaptureOffsetMs(e.target.value)}
              className="mt-1 w-full rounded-md border bg-background px-2 py-1 text-sm text-foreground"
            />
          </label>
          <label className="text-xs text-muted-foreground">
            Event window (ms)
            <input
              type="number"
              min={0}
              max={2000}
              step={10}
              value={eventWindowMs}
              onChange={(e) => setEventWindowMs(e.target.value)}
              className="mt-1 w-full rounded-md border bg-background px-2 py-1 text-sm text-foreground"
            />
          </label>
          <label className="text-xs text-muted-foreground">
            Request timeout (ms)
            <input
              type="number"
              min={100}
              max={5000}
              step={50}
              value={requestTimeoutMs}
              onChange={(e) => setRequestTimeoutMs(e.target.value)}
              className="mt-1 w-full rounded-md border bg-background px-2 py-1 text-sm text-foreground"
            />
          </label>
        </div>
                <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={applyCaptureSettings}
            disabled={setCaptureSettingsMutation.isPending}
          >
            Apply timing
          </Button>
          <span className="text-xs text-muted-foreground">
            Current: offset {status?.capture_settings?.capture_offset_ms ?? 120} ms | window {status?.capture_settings?.event_window_ms ?? 120} ms | mode {status?.capture_settings?.grab_mode === "on_request" ? "on demand" : "background"}
          </span>
        </div>
      </div>

      <div className="rounded-lg border bg-card p-4 space-y-4">
          <div>
            <div className="text-sm font-medium">Temperature Display</div>
          </div>
                  <div className="text-sm">
          <span className="mb-1 font-medium">I²C Sensor BMP280:</span>{" "}
          <span className={cn(getTemperatureBandColorClass(tempC, tempThresholdsC))}>
            {bmp280?.ok
              ? formatTemperature(tempC, unit)
              : `n/a${bmp280?.error ? ` (${bmp280.error})` : ""}`}
          </span>
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
          <div className="text-xs text-muted-foreground rounded-md border border-border/50 bg-background/40 p-2">
            <div className="mb-1 font-medium">Limits</div>
            <div className="flex flex-wrap gap-2">
              <label className="flex items-center gap-1">
                Cool max
                <input
                  type="number"
                  step={0.5}
                  value={cToUnit(tempThresholdsC.coolMax, unit).toFixed(1)}
                  onChange={(e) => updateTemperatureThreshold("coolMax", e.target.value)}
                  className="h-7 w-20 rounded-md border bg-background px-2 text-xs text-foreground"
                />
              </label>
              <label className="flex items-center gap-1">
                Normal max
                <input
                  type="number"
                  step={0.5}
                  value={cToUnit(tempThresholdsC.normalMax, unit).toFixed(1)}
                  onChange={(e) => updateTemperatureThreshold("normalMax", e.target.value)}
                  className="h-7 w-20 rounded-md border bg-background px-2 text-xs text-foreground"
                />
              </label>
              <label className="flex items-center gap-1">
                Hot max
                <input
                  type="number"
                  step={0.5}
                  value={cToUnit(tempThresholdsC.hotMax, unit).toFixed(1)}
                  onChange={(e) => updateTemperatureThreshold("hotMax", e.target.value)}
                  className="h-7 w-20 rounded-md border bg-background px-2 text-xs text-foreground"
                />
              </label>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {tempBands.map((band) => (
              <div key={band.label} className="rounded-md border border-border/60 bg-background/40 p-3">
                <div className={cn("text-sm font-semibold", getTemperatureBandColorClass(band.sample, tempThresholdsC))}>
                  {band.label}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{band.range}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
  );
}
