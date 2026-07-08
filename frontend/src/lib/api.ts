export type PrinterStatus = "idle" | "printing" | "paused" | "offline";

export interface PrintStatusResponse {
  state: string;
  selected_file: string;
  progress: number;
  current_layer?: number;
  layer_count?: number;
  print_time_secs?: number;
  time_left_secs?: number;
}

export interface FileEntry {
  filename: string;
  path: string;
  can_be_printed: boolean;
  print_time_secs?: number;
}

export interface DirectoryEntry {
  dirname: string;
}

export interface FileListResponse {
  files: FileEntry[];
  directories: DirectoryEntry[];
}

export interface FileDetailsResponse {
  filename: string;
  path: string;
  bed_size_mm: number[];
  height_mm: number;
  layer_count: number;
  layer_height_mm: number;
  resolution: number[];
  print_time_secs: number;
}

export interface TimelapseVideoEntry {
  filename: string;
  size_mb: number;
  created_at: string;
  modified_at: string;
}

export interface TimelapseSessionEntry {
  session_id: string;
  frame_count: number;
  created_at: string;
  modified_at: string;
  active: boolean;
}

export interface TimelapseDiskSpaceResponse {
  free_gb: number;
  used_gb: number;
  total_gb: number;
  used_percent: number;
  sufficient: boolean;
}

export interface TimelapseRenderResponse {
  filename: string;
  size_mb: number;
  frame_count: number;
  fps: number;
  preset: string;
  capture_profile?: "HIGH" | "MID" | "LOW";
  stream_path?: string;
  created_at: string;
}

export interface TimelapseDetectorStatus {
  running: boolean;
  gpio_available: boolean;
  sensor_a: boolean;
  sensor_b: boolean;
  top_event_count: number;
  last_top_detected_at: string | null;
  last_event_simulated: boolean;
  top_entry_sensor: "A" | "B";
  top_entry_state: boolean[];
  invert: boolean;
  last_state: boolean[];
  last_transition: { from: boolean[]; to: boolean[] } | null;
}

export interface TimelapseStatusResponse {
  ready: boolean;
  recording: boolean;
  session_id: string | null;
  last_session_id: string | null;
  frame_count: number;
  pending_frames: number;
  z_detector_running: boolean;
  stream_profile: "HIGH" | "MID" | "LOW";
  restart_required: boolean;
  detector: TimelapseDetectorStatus | null;
}

export interface TimelapseProfileDetails {
  resolution: string;
  bitrate: string;
  fps: string;
}

export interface TimelapseProfilesResponse {
  active: "HIGH" | "MID" | "LOW";
  available: Array<"HIGH" | "MID" | "LOW">;
  restart_required: boolean;
  stream_path: string;
  profiles: Record<"HIGH" | "MID" | "LOW", TimelapseProfileDetails>;
  note: string;
}

function getCsrfToken(): string | null {
  const meta = document.querySelector('meta[name="csrf-token"]');
  return meta?.getAttribute("content") ?? null;
}

async function apiFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };

  const csrf = getCsrfToken();
  if (csrf) {
    headers["X-CSRFToken"] = csrf;
  }

  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export const api = {
  async printStatus(): Promise<PrintStatusResponse> {
    return apiFetch<PrintStatusResponse>("/api/print_status");
  },

  async listFiles(path: string = "."): Promise<FileListResponse> {
    return apiFetch<FileListResponse>(
      `/api/list_files?path=${encodeURIComponent(path)}`,
    );
  },

  async fileDetails(filename: string): Promise<FileDetailsResponse> {
    return apiFetch<FileDetailsResponse>(
      `/api/file_details?filename=${encodeURIComponent(filename)}`,
    );
  },

  filePreviewUrl(filename: string): string {
    return `/api/file_preview?filename=${encodeURIComponent(filename)}`;
  },

  async uploadFile(file: File, path: string = "."): Promise<void> {
    const formData = new FormData();
    formData.append("file", file);
    const csrf = getCsrfToken();
    const headers: Record<string, string> = {};
    if (csrf) headers["X-CSRFToken"] = csrf;
    const q = new URLSearchParams({ path });
    const res = await fetch(`/api/upload_file?${q.toString()}`, {
      method: "POST",
      headers,
      body: formData,
    });
    if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
  },

  async deleteFile(filename: string): Promise<void> {
    await apiFetch(
      `/api/delete_file?filename=${encodeURIComponent(filename)}`,
      {
        method: "POST",
      },
    );
  },

  async createDirectory(parentPath: string, name: string): Promise<void> {
    const params = new URLSearchParams({
      path: parentPath,
      name,
    });
    await apiFetch(`/api/create_directory?${params.toString()}`, {
      method: "POST",
    });
  },

  async hostShutdown(): Promise<void> {
    await apiFetch("/api/host/shutdown", { method: "POST" });
  },

  async hostReboot(): Promise<void> {
    await apiFetch("/api/host/reboot", { method: "POST" });
  },

  async timelapseListVideos(): Promise<TimelapseVideoEntry[]> {
    return apiFetch<TimelapseVideoEntry[]>("/api/timelapse/videos");
  },

  async timelapseListSessions(): Promise<TimelapseSessionEntry[]> {
    return apiFetch<TimelapseSessionEntry[]>("/api/timelapse/sessions");
  },

  async timelapseDeleteVideo(filename: string): Promise<void> {
    await apiFetch(`/api/timelapse/videos/${encodeURIComponent(filename)}`, {
      method: "DELETE",
    });
  },


  async timelapseDeleteSession(sessionId: string): Promise<void> {
    await apiFetch(
      `/api/timelapse/sessions/${encodeURIComponent(sessionId)}/delete`,
      {
        method: "POST",
      },
    );
  },

  async timelapseDiskSpace(): Promise<TimelapseDiskSpaceResponse> {
    return apiFetch<TimelapseDiskSpaceResponse>("/api/timelapse/disk-space");
  },

  async timelapseRender(
    sessionId: string,
    preset: "smooth_60fps" | "normal_30fps" | "cinematic_25fps",
    options?: { outputName?: string; keepSession?: boolean },
  ): Promise<TimelapseRenderResponse> {
    return apiFetch<TimelapseRenderResponse>("/api/timelapse/render", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: sessionId,
        preset,
        output_name: options?.outputName,
        keep_session: Boolean(options?.keepSession),
      }),
    });
  },

  async timelapseStatus(): Promise<TimelapseStatusResponse> {
    return apiFetch<TimelapseStatusResponse>("/api/timelapse/status");
  },

  async timelapseProfiles(): Promise<TimelapseProfilesResponse> {
    return apiFetch<TimelapseProfilesResponse>("/api/timelapse/profiles");
  },

  async timelapseSetProfile(
    profile: "HIGH" | "MID" | "LOW",
  ): Promise<TimelapseProfilesResponse> {
    return apiFetch<TimelapseProfilesResponse>(
      `/api/timelapse/profiles/${profile}`,
      {
        method: "POST",
      },
    );
  },

  async timelapseSetDetectorInvert(
    invert: boolean,
  ): Promise<TimelapseDetectorStatus> {
    const value = invert ? "1" : "0";
    return apiFetch<TimelapseDetectorStatus>(
      `/api/timelapse/detector/invert?invert=${value}`,
      { method: "POST" },
    );
  },

  async timelapseStartSession(
    sessionId?: string,
  ): Promise<{ status: string; session_id: string }> {
    return apiFetch("/api/timelapse/session/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sessionId ? { session_id: sessionId } : {}),
    });
  },

  async timelapseEndSession(): Promise<{
    status: string;
    session_id: string;
    videos?: TimelapseVideoEntry[];
  }> {
    return apiFetch("/api/timelapse/session/end", { method: "POST" });
  },

  async timelapseCapture(): Promise<{ status: string }> {
    return apiFetch("/api/timelapse/capture", { method: "POST" });
  },

  async timelapseTestTrigger(): Promise<{
    status: string;
    capture_queued: boolean;
    detector: TimelapseDetectorStatus;
  }> {
    return apiFetch("/api/timelapse/test-trigger", { method: "POST" });
  },

  async bmp280Temperature(): Promise<{
    ok: boolean;
    sensor: string;
    temp_c: number | null;
    error?: string;
  }> {
    return apiFetch("/api/sensors/bmp280");
  },

  async printerCommand(
    command: "start_print" | "pause_print" | "resume_print" | "cancel_print",
    filename?: string,
  ): Promise<void> {
    const params = filename ? `?filename=${encodeURIComponent(filename)}` : "";
    await apiFetch(`/api/printer/command/${command}${params}`, {
      method: "POST",
    });
  },
};

export function mapPrinterState(state: string): PrinterStatus {
  switch (state) {
    case "PRINTING":
    case "STARTING_PRINT":
      return "printing";
    case "PAUSED":
      return "paused";
    case "CLOSED":
      return "offline";
    default:
      return "idle";
  }
}

export function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}


