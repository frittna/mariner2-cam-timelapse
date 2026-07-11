import json
import logging
import re
import subprocess
import threading
import time
import urllib.request
from collections import deque
from pathlib import Path
from typing import Deque, Dict, Optional

from mariner.server.timelapse_manager import SESSIONS_DIR

logger = logging.getLogger(__name__)

PROFILE_TO_STREAM = {
    "HIGH": "cam",
    "MID": "cam",
    "LOW": "cam",
}

PROFILE_SETTINGS = {
    "HIGH": {
        "rpiCameraWidth": 1296,
        "rpiCameraHeight": 972,
        "rpiCameraFPS": 30,
        "rpiCameraBitrate": 4000000,
        "rpiCameraProfile": "main",
    },
    "MID": {
        "rpiCameraWidth": 1024,
        "rpiCameraHeight": 768,
        "rpiCameraFPS": 20,
        "rpiCameraBitrate": 2000000,
        "rpiCameraProfile": "main",
    },
    "LOW": {
        "rpiCameraWidth": 640,
        "rpiCameraHeight": 480,
        "rpiCameraFPS": 15,
        "rpiCameraBitrate": 800000,
        "rpiCameraProfile": "main",
    },
}


def _format_bitrate(bitrate: int) -> str:
    if bitrate >= 1000000:
        value = bitrate / 1000000
        return f"{int(value) if value.is_integer() else value} Mbps"
    return f"{int(bitrate / 1000)} kbps"


def get_profile_details() -> dict[str, dict[str, str]]:
    return {
        name: {
            "resolution": f"{settings['rpiCameraWidth']}x{settings['rpiCameraHeight']}",
            "bitrate": _format_bitrate(int(settings["rpiCameraBitrate"])),
            "fps": str(settings["rpiCameraFPS"]),
        }
        for name, settings in PROFILE_SETTINGS.items()
    }


class TimelapseWorker:
    def __init__(
        self,
        mediamtx_host: str = "localhost",
        mediamtx_port: int = 8554,
        stream_profile: str = "HIGH",
    ) -> None:
        self.mediamtx_host = mediamtx_host
        self.mediamtx_port = mediamtx_port
        self.stream_profile = (
            stream_profile if stream_profile in PROFILE_TO_STREAM else "HIGH"
        )
        self.current_session_id: Optional[str] = None
        self.last_session_id: Optional[str] = None
        self.frame_counter = 0
        self.is_recording = False

        self._lock = threading.Lock()
        self._pending_lock = threading.Lock()
        self._frame_lock = threading.Lock()

        self._pending_frames = 0
        self._all_frames_done = threading.Event()
        self._all_frames_done.set()

        self._capture_requests_total = 0
        self._capture_success_total = 0
        self._capture_fail_total = 0

        self._next_request_id = 1
        self._next_finalize_request_id = 1
        self._next_written_frame_number = 0
        self._completed_requests: Dict[int, Optional[Path]] = {}

        self._capture_offset_seconds = 0.12
        self._event_window_seconds = 0.12
        self._request_timeout_seconds = 1.0
        self._buffer_seconds = 2.0
        self._grabber_output_fps = 15

        self._pending_capture_requests: Deque[tuple[int, float, Path]] = deque()
        self._frame_buffer: Deque[tuple[float, bytes]] = deque()
        self._last_capture_request_at = 0.0

        self._pipeline_stop = threading.Event()
        self._grabber_thread: Optional[threading.Thread] = None
        self._scheduler_thread: Optional[threading.Thread] = None

        self._apply_profile_to_mediamtx(self.stream_profile)

    def shutdown(self) -> None:
        self._stop_capture_pipeline()

    def set_profile(self, profile: str) -> str:
        with self._lock:
            if profile in PROFILE_TO_STREAM:
                self.stream_profile = profile
                self._apply_profile_to_mediamtx(profile)
            return self.stream_profile

    def get_capture_settings(self) -> dict[str, float | int]:
        with self._pending_lock:
            return {
                "capture_offset_ms": round(self._capture_offset_seconds * 1000.0, 1),
                "event_window_ms": round(self._event_window_seconds * 1000.0, 1),
                "buffer_seconds": round(self._buffer_seconds, 2),
                "request_timeout_ms": round(self._request_timeout_seconds * 1000.0, 1),
                "grabber_fps": int(self._grabber_output_fps),
            }

    def set_capture_settings(self, settings: dict[str, object]) -> dict[str, float | int]:
        with self._pending_lock:
            if "capture_offset_ms" in settings:
                self._capture_offset_seconds = self._clamp_float(
                    settings["capture_offset_ms"],
                    minimum=0.0,
                    maximum=2000.0,
                    default=self._capture_offset_seconds * 1000.0,
                ) / 1000.0

            if "event_window_ms" in settings:
                self._event_window_seconds = self._clamp_float(
                    settings["event_window_ms"],
                    minimum=0.0,
                    maximum=2000.0,
                    default=self._event_window_seconds * 1000.0,
                ) / 1000.0

            if "buffer_seconds" in settings:
                self._buffer_seconds = self._clamp_float(
                    settings["buffer_seconds"],
                    minimum=0.2,
                    maximum=10.0,
                    default=self._buffer_seconds,
                )

            if "request_timeout_ms" in settings:
                self._request_timeout_seconds = self._clamp_float(
                    settings["request_timeout_ms"],
                    minimum=100.0,
                    maximum=5000.0,
                    default=self._request_timeout_seconds * 1000.0,
                ) / 1000.0

            if "grabber_fps" in settings:
                self._grabber_output_fps = int(
                    self._clamp_float(
                        settings["grabber_fps"],
                        minimum=2.0,
                        maximum=30.0,
                        default=float(self._grabber_output_fps),
                    )
                )

        return self.get_capture_settings()

    @staticmethod
    def _clamp_float(value: object, minimum: float, maximum: float, default: float) -> float:
        try:
            numeric = float(value)
        except (TypeError, ValueError):
            numeric = default
        return max(minimum, min(maximum, numeric))

    def _apply_profile_to_mediamtx(self, profile: str) -> None:
        settings = PROFILE_SETTINGS.get(profile, PROFILE_SETTINGS["HIGH"])
        api_url = f"http://{self.mediamtx_host}:9997/v3/config/paths/patch/cam"
        try:
            data = json.dumps(settings).encode("utf-8")
            req = urllib.request.Request(api_url, data=data, method="PATCH")
            req.add_header("Content-Type", "application/json")
            urllib.request.urlopen(req, timeout=3)
            logger.info("MediaMTX profile updated to %s", profile)
        except Exception as exc:
            logger.warning("MediaMTX profile update failed: %s", exc)

    def start_session(self, session_id: str) -> Optional[str]:
        cleaned = self._sanitize_session_id(session_id)
        if not cleaned:
            return None

        with self._lock:
            if self.is_recording:
                return None
            (SESSIONS_DIR / cleaned).mkdir(parents=True, exist_ok=True)
            self.current_session_id = cleaned
            self.last_session_id = cleaned
            self.frame_counter = 0
            self.is_recording = True

        with self._pending_lock:
            self._pending_frames = 0
            self._all_frames_done.set()
            self._capture_requests_total = 0
            self._capture_success_total = 0
            self._capture_fail_total = 0
            self._next_request_id = 1
            self._next_finalize_request_id = 1
            self._next_written_frame_number = 0
            self._completed_requests = {}
            self._pending_capture_requests.clear()
            self._last_capture_request_at = 0.0

        with self._frame_lock:
            self._frame_buffer.clear()

        self._start_capture_pipeline()
        return cleaned

    def end_session(self) -> Optional[Path]:
        with self._lock:
            if not self.is_recording or not self.current_session_id:
                return None
            session_id = self.current_session_id
            self.is_recording = False
            self.current_session_id = None
            self.frame_counter = 0

        self._wait_for_pending_frames(timeout=20.0)
        self._stop_capture_pipeline()
        return SESSIONS_DIR / session_id

    def capture_frame(self) -> bool:
        with self._lock:
            if not self.is_recording or not self.current_session_id:
                return False
            session_id = self.current_session_id

        now = time.monotonic()
        with self._pending_lock:
            if now - self._last_capture_request_at < self._event_window_seconds:
                return True

            request_id = self._next_request_id
            self._next_request_id += 1
            self._capture_requests_total += 1
            self._last_capture_request_at = now
            target_time = now + self._capture_offset_seconds
            frame_path = SESSIONS_DIR / session_id / f"_pending_{request_id:06d}.jpg"
            self._pending_capture_requests.append((request_id, target_time, frame_path))

        self._mark_frame_queued()
        return True

    def _start_capture_pipeline(self) -> None:
        self._pipeline_stop.clear()

        if self._grabber_thread is None or not self._grabber_thread.is_alive():
            self._grabber_thread = threading.Thread(
                target=self._grabber_loop,
                daemon=True,
                name="timelapse-grabber",
            )
            self._grabber_thread.start()

        if self._scheduler_thread is None or not self._scheduler_thread.is_alive():
            self._scheduler_thread = threading.Thread(
                target=self._scheduler_loop,
                daemon=True,
                name="timelapse-scheduler",
            )
            self._scheduler_thread.start()

    def _stop_capture_pipeline(self) -> None:
        self._pipeline_stop.set()

        if self._grabber_thread is not None:
            self._grabber_thread.join(timeout=2.0)
            self._grabber_thread = None

        if self._scheduler_thread is not None:
            self._scheduler_thread.join(timeout=2.0)
            self._scheduler_thread = None

        self._flush_abandoned_requests()
        with self._frame_lock:
            self._frame_buffer.clear()

    def _flush_abandoned_requests(self) -> None:
        abandoned: list[tuple[int, Path]] = []
        with self._pending_lock:
            while self._pending_capture_requests:
                request_id, _, frame_path = self._pending_capture_requests.popleft()
                self._capture_fail_total += 1
                abandoned.append((request_id, frame_path))

        for request_id, frame_path in abandoned:
            if frame_path.exists():
                frame_path.unlink(missing_ok=True)
            self._finalize_captured_request(request_id, frame_path, False)
            self._mark_frame_finished()

    def _grabber_loop(self) -> None:
        soi = b"\xff\xd8"
        eoi = b"\xff\xd9"

        while not self._pipeline_stop.is_set():
            rtsp_url = self._rtsp_url()
            cmd = [
                "ffmpeg",
                "-loglevel",
                "error",
                "-rtsp_transport",
                "tcp",
                "-i",
                rtsp_url,
                "-an",
                "-vf",
                f"fps={self._grabber_output_fps}",
                "-f",
                "image2pipe",
                "-vcodec",
                "mjpeg",
                "-q:v",
                "3",
                "-",
            ]

            proc: Optional[subprocess.Popen[bytes]] = None
            try:
                proc = subprocess.Popen(
                    cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.DEVNULL,
                    bufsize=0,
                )

                if proc.stdout is None:
                    raise RuntimeError("ffmpeg stdout unavailable")

                buffer = bytearray()

                while not self._pipeline_stop.is_set():
                    chunk = proc.stdout.read(4096)
                    if not chunk:
                        break
                    buffer.extend(chunk)

                    while True:
                        start = buffer.find(soi)
                        if start < 0:
                            if len(buffer) > 131072:
                                del buffer[:-2]
                            break

                        end = buffer.find(eoi, start + 2)
                        if end < 0:
                            if start > 0:
                                del buffer[:start]
                            break

                        jpg = bytes(buffer[start : end + 2])
                        del buffer[: end + 2]
                        self._store_buffered_frame(jpg, time.monotonic())

            except Exception:
                logger.exception("Timelapse grabber loop error")
            finally:
                if proc is not None and proc.poll() is None:
                    proc.terminate()
                    try:
                        proc.wait(timeout=1.0)
                    except subprocess.TimeoutExpired:
                        proc.kill()

            if not self._pipeline_stop.is_set():
                time.sleep(0.2)

    def _scheduler_loop(self) -> None:
        while not self._pipeline_stop.is_set():
            request: Optional[tuple[int, float, Path]] = None
            with self._pending_lock:
                if self._pending_capture_requests:
                    request = self._pending_capture_requests[0]

            if request is None:
                time.sleep(0.01)
                continue

            request_id, target_time, frame_path = request
            now = time.monotonic()

            if now < target_time:
                time.sleep(min(0.01, target_time - now))
                continue

            frame_bytes = self._pick_frame_for_target(target_time)
            if frame_bytes is not None:
                success = self._write_frame(frame_path, frame_bytes)
                self._complete_capture_request(request_id, frame_path, success)
                continue

            if now - target_time >= self._request_timeout_seconds:
                self._complete_capture_request(request_id, frame_path, False)
                continue

            time.sleep(0.01)

    def _pick_frame_for_target(self, target_time: float) -> Optional[bytes]:
        with self._frame_lock:
            if not self._frame_buffer:
                return None
            return min(
                self._frame_buffer,
                key=lambda item: abs(item[0] - target_time),
            )[1]

    def _store_buffered_frame(self, frame_bytes: bytes, frame_time: float) -> None:
        with self._frame_lock:
            self._frame_buffer.append((frame_time, frame_bytes))
            cutoff = frame_time - self._buffer_seconds
            while self._frame_buffer and self._frame_buffer[0][0] < cutoff:
                self._frame_buffer.popleft()

    @staticmethod
    def _write_frame(frame_path: Path, frame_bytes: bytes) -> bool:
        try:
            frame_path.write_bytes(frame_bytes)
            return True
        except OSError:
            logger.exception("Failed writing timelapse frame %s", frame_path)
            if frame_path.exists():
                frame_path.unlink(missing_ok=True)
            return False

    def _complete_capture_request(
        self,
        request_id: int,
        frame_path: Path,
        success: bool,
    ) -> None:
        removed = False
        with self._pending_lock:
            if (
                self._pending_capture_requests
                and self._pending_capture_requests[0][0] == request_id
            ):
                self._pending_capture_requests.popleft()
                removed = True
                if success:
                    self._capture_success_total += 1
                else:
                    self._capture_fail_total += 1

        if not removed:
            return

        if not success and frame_path.exists():
            frame_path.unlink(missing_ok=True)

        self._finalize_captured_request(request_id, frame_path, success)
        self._mark_frame_finished()

    def _rtsp_url(self) -> str:
        with self._lock:
            stream_path = PROFILE_TO_STREAM.get(
                self.stream_profile,
                PROFILE_TO_STREAM["HIGH"],
            )
        return f"rtsp://{self.mediamtx_host}:{self.mediamtx_port}/{stream_path}"

    def _mark_frame_queued(self) -> None:
        with self._pending_lock:
            self._pending_frames += 1
            self._all_frames_done.clear()

    def _mark_frame_finished(self) -> None:
        with self._pending_lock:
            if self._pending_frames > 0:
                self._pending_frames -= 1
            if self._pending_frames == 0:
                self._all_frames_done.set()

    def _wait_for_pending_frames(self, timeout: float) -> None:
        if not self._all_frames_done.wait(timeout=timeout):
            with self._pending_lock:
                pending = self._pending_frames
            logger.warning(
                "Timed out waiting for pending timelapse frames to finish: %s pending",
                pending,
            )

    def get_pending_frames(self) -> int:
        with self._pending_lock:
            return self._pending_frames

    def get_capture_counters(self) -> dict[str, int]:
        with self._pending_lock:
            return {
                "capture_requests_total": self._capture_requests_total,
                "capture_success_total": self._capture_success_total,
                "capture_fail_total": self._capture_fail_total,
            }

    def _finalize_captured_request(
        self, request_id: int, pending_frame_path: Path, success: bool
    ) -> None:
        with self._pending_lock:
            self._completed_requests[request_id] = pending_frame_path if success else None
            self._drain_completed_requests_locked()

    def _drain_completed_requests_locked(self) -> None:
        while self._next_finalize_request_id in self._completed_requests:
            pending_path = self._completed_requests.pop(self._next_finalize_request_id)
            if pending_path is not None and pending_path.exists():
                self._next_written_frame_number += 1
                final_path = (
                    pending_path.parent
                    / f"frame_{self._next_written_frame_number:06d}.jpg"
                )
                try:
                    pending_path.replace(final_path)
                    self.frame_counter = self._next_written_frame_number
                except OSError:
                    logger.exception("Failed finalizing timelapse frame %s", pending_path)
                    if pending_path.exists():
                        pending_path.unlink(missing_ok=True)
            self._next_finalize_request_id += 1

    @staticmethod
    def _sanitize_session_id(raw: str) -> str:
        cleaned = re.sub(r"[^a-zA-Z0-9._-]", "_", (raw or "").strip())
        return cleaned[:64]
