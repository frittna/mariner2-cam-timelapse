import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Thermometer, Film, Trash2 } from "lucide-react";
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
      queryClient.invalidateQueries({ queryKey: ["timelapse-profiles"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const renderMutation = useMutation({
    mutationFn: (preset: "smooth_60fps" | "normal_30fps" | "cinematic_25fps") => {
      if (!status?.session_id) throw new Error("Keine Session-ID verfügbar");
      return api.timelapseRender(status.session_id, preset);
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

  const profile = profileData?.active ?? "HIGH";

  return (
    <div className="container pt-2 pb-2 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Timelapse</h1>
          <p className="text-sm text-muted-foreground">
            Isolierte Timelapse-Steuerung mit Z-Trigger und Video-Rendering
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Thermometer className="h-4 w-4" />
          {bmp280?.ok ? `${bmp280.temp_c?.toFixed(1)}°C` : "BMP280: n/a"}
        </div>
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
        </div>
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
      </div>

      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="text-sm font-medium">Video Rendering</div>
        <div className="flex flex-wrap gap-2">
          {RENDER_PRESETS.map((preset) => (
            <Button
              key={preset.value}
              size="sm"
              onClick={() => renderMutation.mutate(preset.value)}
              disabled={renderMutation.isPending || !status?.session_id}
            >
              {preset.label}
            </Button>
          ))}
        </div>
        <div className="text-xs text-muted-foreground">
          Disk: {disk ? `${disk.free_gb.toFixed(1)} GB frei` : "…"}
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
