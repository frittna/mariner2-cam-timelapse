import json
import logging
import re
import subprocess
import threading
import time
import urllib.request
from collections import deque
from pathlib import Path
from typing import Callable, Deque, Dict, Optional

from mariner.server.timelapse_manager import SESSIONS_DIR

try:
    import fcntl  # type: ignore
except ImportError:  # pragma: no cover - not available on Windows
    fcntl = None

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
        "rpiCameraFPS": 25,
        "rpiCameraBitrate": 4500000,
        "rpiCameraProfile": "main",
        "rpiCameraIDRPeriod": 25,
    },
    "MID": {
        "rpiCameraWidth": 1024,
        "rpiCameraHeight": 768,
        "rpiCameraFPS": 20,
        "rpiCameraBitrate": 3000000,
        "rpiCameraProfile": "main",
        "rpiCameraIDRPeriod": 20,
    },
    "LOW": {
        "rpiCameraWidth": 640,
        "rpiCameraHeight": 480,
        "rpiCameraFPS": 15,
        "rpiCameraBitrate": 1000000,
        "rpiCameraProfile": "main",
        "rpiCameraIDRPeriod": 15,
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
        on_capture_completed: Optional[Callable[[bool], None]] = None,
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
        self._capture_duration_last_ms = 0.0
        self._capture_duration_sum_ms = 0.0
        self._capture_duration_count = 0
        self._capture_duration_max_ms = 0.0

        self._next_request_id = 1
        self._next_finalize_request_id = 1
        self._next_written_frame_number = 0
        self._completed_requests: Dict[int, Optional[Path]] = {}

        self._capture_offset_seconds = 0.04
        self._event_window_seconds = 0.01
        self._request_timeout_seconds = 3.0

        self._pending_capture_requests: Deque[tuple[int, float, Path]] = deque()
        self._last_capture_request_at = 0.0

        self._buffer_seconds = 3.0
        self._grabber_output_fps = 3
        self._frame_buffer: Deque[tuple[float, bytes]] = deque(maxlen=180)
        self._last_frame_ts = 0.0

        self._pipeline_stop = threading.Event()
        self._pipeline_started_at = 0.0
        self._pipeline_control_lock = threading.Lock()
        self._grabber_process_lock = threading.Lock()
        self._scheduler_thread: Optional[threading.Thread] = None
        self._grabber_thread: Optional[threading.Thread] = None
        self._grabber_process: Optional[subprocess.Popen] = None
        self._session_lock_file = Path("/tmp/mariner_timelapse_session.lock")
        self._session_lock_fd = None

        self._on_capture_completed = on_capture_completed

        self._apply_profile_to_mediamtx(self.stream_profile)

    def shutdown(self) -> None:
        self._stop_capture_pipeline()
        self._release_session_lock()


    def set_capture_completed_callback(
        self, callback: Optional[Callable[[bool], None]]
    ) -> None:
        self._on_capture_completed = callback

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
                "request_timeout_ms": round(self._request_timeout_seconds * 1000.0, 1),
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

            if "request_timeout_ms" in settings:
                self._request_timeout_seconds = self._clamp_float(
                    settings["request_timeout_ms"],
                    minimum=100.0,
                    maximum=8000.0,
                    default=self._request_timeout_seconds * 1000.0,
                ) / 1000.0

        return self.get_capture_settings()

    @staticmethod
    def _clamp_float(value: object, minimum: float, maximum: float, default: float) -> float:
        try:
            numeric = float(value)
        except (TypeError, ValueError):
            numeric = default
        return max(minimum, min(maximum, numeric))

    @staticmethod
    def _unique_session_id(base_session_id: str) -> str:
        candidate = base_session_id
        suffix = 2
        while (SESSIONS_DIR / candidate).exists():
            candidate = f"{base_session_id}-{suffix:02d}"
            suffix += 1
        return candidate

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

        if not self._acquire_session_lock():
            logger.warning(
                "Refusing timelapse start: session lock is already held by another process"
            )
            return None

        with self._lock:
            if self.is_recording:
                self._release_session_lock()
                return None
            unique_session_id = self._unique_session_id(cleaned)
            (SESSIONS_DIR / unique_session_id).mkdir(parents=True, exist_ok=True)
            self.current_session_id = unique_session_id
            self.last_session_id = unique_session_id
            self.frame_counter = 0
            self.is_recording = True

        with self._pending_lock:
            self._pending_frames = 0
            self._all_frames_done.set()
            self._capture_requests_total = 0
            self._capture_success_total = 0
            self._capture_fail_total = 0
            self._capture_duration_last_ms = 0.0
            self._capture_duration_sum_ms = 0.0
            self._capture_duration_count = 0
            self._capture_duration_max_ms = 0.0
            self._next_request_id = 1
            self._next_finalize_request_id = 1
            self._next_written_frame_number = 0
            self._completed_requests = {}
            self._pending_capture_requests.clear()
            self._last_capture_request_at = 0.0

        self._start_capture_pipeline()
        self._wait_for_buffer_warmup(timeout=1.5)
        return unique_session_id

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
        self._release_session_lock()
        return SESSIONS_DIR / session_id

    def _acquire_session_lock(self) -> bool:
        if fcntl is None:
            return True
        if self._session_lock_fd is not None:
            return True
        self._session_lock_file.parent.mkdir(parents=True, exist_ok=True)
        fd = self._session_lock_file.open("w")
        try:
            fcntl.flock(fd.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            fd.close()
            return False
        self._session_lock_fd = fd
        return True

    def _release_session_lock(self) -> None:
        if fcntl is None:
            self._session_lock_fd = None
            return
        if self._session_lock_fd is None:
            return
        try:
            fcntl.flock(self._session_lock_fd.fileno(), fcntl.LOCK_UN)
        except OSError:
            logger.exception("Failed to release timelapse session lock")
        try:
            self._session_lock_fd.close()
        finally:
            self._session_lock_fd = None

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
        with self._pipeline_control_lock:
            self._pipeline_stop.clear()
            self._pipeline_started_at = time.monotonic()

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
        with self._pipeline_control_lock:
            self._pipeline_stop.set()

        grabber_process = None
        with self._grabber_process_lock:
            grabber_process = self._grabber_process

        if grabber_process is not None and grabber_process.poll() is None:
            grabber_process.terminate()
            try:
                grabber_process.wait(timeout=1.0)
            except subprocess.TimeoutExpired:
                grabber_process.kill()

        if self._scheduler_thread is not None:
            self._scheduler_thread.join(timeout=5.0)
            if self._scheduler_thread.is_alive():
                logger.warning("Timed out waiting for timelapse scheduler thread to stop")
            else:
                self._scheduler_thread = None

        if self._grabber_thread is not None:
            self._grabber_thread.join(timeout=5.0)
            if self._grabber_thread.is_alive():
                logger.warning("Timed out waiting for timelapse grabber thread to stop")
            else:
                self._grabber_thread = None

        with self._grabber_process_lock:
            self._grabber_process = None

        self._flush_abandoned_requests()

    def _wait_for_buffer_warmup(self, timeout: float) -> None:
        deadline = time.monotonic() + max(0.0, timeout)
        while time.monotonic() < deadline and not self._pipeline_stop.is_set():
            with self._frame_lock:
                if self._frame_buffer:
                    return
            time.sleep(0.01)
        logger.warning("Timelapse frame buffer warmup timeout after %.1f s", timeout)

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

    def _rtsp_url(self) -> str:
        with self._lock:
            stream_path = PROFILE_TO_STREAM.get(
                self.stream_profile,
                PROFILE_TO_STREAM["HIGH"],
            )
        return f"rtsp://{self.mediamtx_host}:{self.mediamtx_port}/{stream_path}"

    def _grabber_cmd(self) -> list[str]:
        return [
            "ffmpeg",
            "-nostdin",
            "-loglevel",
            "error",
            "-rtsp_transport",
            "tcp",
            "-i",
            self._rtsp_url(),
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

    def _grabber_retry_delay(self, consecutive_failures: int) -> float:
        # During early boot, back off a bit more if the camera stream is not ready.
        in_boot_window = (
            self._pipeline_started_at > 0
            and (time.monotonic() - self._pipeline_started_at) < 25.0
            and self._last_frame_ts == 0.0
        )
        if in_boot_window:
            return min(1.2, 0.4 + 0.2 * min(4, consecutive_failures))
        return min(1.0, 0.2 + 0.2 * min(4, consecutive_failures))

    def _grabber_loop(self) -> None:
        consecutive_failures = 0
        while not self._pipeline_stop.is_set():
            process = None
            saw_frames = False
            try:
                before_ts = self._last_frame_ts
                process = subprocess.Popen(
                    self._grabber_cmd(),
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    bufsize=0,
                )
                with self._grabber_process_lock:
                    self._grabber_process = process

                stdout = process.stdout
                if stdout is None:
                    raise RuntimeError("ffmpeg stdout pipe unavailable")

                self._read_mjpeg_stream(stdout)
                saw_frames = self._last_frame_ts > before_ts
            except Exception:
                logger.exception("Timelapse grabber loop crashed")
            finally:
                if process is not None:
                    if process.poll() is None:
                        process.terminate()
                        try:
                            process.wait(timeout=1.0)
                        except subprocess.TimeoutExpired:
                            process.kill()
                    stderr_text = b""
                    if process.stderr is not None:
                        try:
                            stderr_text = process.stderr.read(2048) or b""
                        except Exception:
                            stderr_text = b""
                    if stderr_text:
                        logger.warning("grabber ffmpeg stderr: %s", stderr_text.decode("utf-8", errors="replace").strip()[:500])
                with self._grabber_process_lock:
                    if self._grabber_process is process:
                        self._grabber_process = None

            if saw_frames:
                consecutive_failures = 0
            else:
                consecutive_failures += 1

            if not self._pipeline_stop.is_set():
                time.sleep(self._grabber_retry_delay(consecutive_failures))

    def _read_mjpeg_stream(self, stdout_pipe) -> None:
        buffer = bytearray()
        while not self._pipeline_stop.is_set():
            chunk = stdout_pipe.read(4096)
            if not chunk:
                return

            buffer.extend(chunk)
            while True:
                soi = buffer.find(b"\xff\xd8")
                if soi < 0:
                    if len(buffer) > 1024 * 1024:
                        del buffer[:-2]
                    break

                if soi > 0:
                    del buffer[:soi]

                eoi = buffer.find(b"\xff\xd9", 2)
                if eoi < 0:
                    break

                frame = bytes(buffer[: eoi + 2])
                del buffer[: eoi + 2]
                self._store_frame(frame)

    def _store_frame(self, frame: bytes) -> None:
        ts = time.monotonic()
        with self._frame_lock:
            self._frame_buffer.append((ts, frame))
            self._last_frame_ts = ts
            cutoff = ts - self._buffer_seconds
            while self._frame_buffer and self._frame_buffer[0][0] < cutoff:
                self._frame_buffer.popleft()

    def _select_frame_for_target(self, target_time: float) -> Optional[bytes]:
        with self._frame_lock:
            if not self._frame_buffer:
                return None

            now = time.monotonic()
            cutoff = now - self._buffer_seconds
            while self._frame_buffer and self._frame_buffer[0][0] < cutoff:
                self._frame_buffer.popleft()
            if not self._frame_buffer:
                return None

            older_candidate: Optional[tuple[float, bytes]] = None
            newer_candidate: Optional[tuple[float, bytes]] = None

            for ts, frame in self._frame_buffer:
                if ts <= target_time:
                    older_candidate = (ts, frame)
                    continue
                newer_candidate = (ts, frame)
                break

            if older_candidate and newer_candidate:
                older_delta = target_time - older_candidate[0]
                newer_delta = newer_candidate[0] - target_time
                return older_candidate[1] if older_delta <= newer_delta else newer_candidate[1]

            if newer_candidate:
                return newer_candidate[1]

            # If no newer frame exists, allow latest old frame after a small grace period.
            grace = max(0.02, 1.5 / max(1, self._grabber_output_fps))
            if now - target_time >= grace:
                return self._frame_buffer[-1][1]

            return None

    def _capture_with_ffmpeg_snapshot(self, frame_path: Path, timeout: float) -> bool:
        cmd = [
            "ffmpeg",
            "-nostdin",
            "-loglevel",
            "error",
            "-rtsp_transport",
            "tcp",
            "-i",
            self._rtsp_url(),
            "-an",
            "-frames:v",
            "1",
            "-q:v",
            "3",
            str(frame_path),
        ]
        try:
            subprocess.run(cmd, capture_output=True, check=True, timeout=timeout)
            return True
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
            return False

    def _capture_from_buffer(self, target_time: float, frame_path: Path) -> bool:
        started = time.monotonic()
        deadline = target_time + self._request_timeout_seconds

        while not self._pipeline_stop.is_set():
            now = time.monotonic()
            if now > deadline:
                if self._capture_with_ffmpeg_snapshot(
                    frame_path,
                    timeout=max(0.5, min(2.5, self._request_timeout_seconds)),
                ):
                    elapsed_ms = (time.monotonic() - started) * 1000.0
                    self._record_capture_duration(elapsed_ms)
                    logger.info(
                        "Timelapse snapshot fallback succeeded in %.0f ms", elapsed_ms
                    )
                    return True

                elapsed_ms = (time.monotonic() - started) * 1000.0
                self._record_capture_duration(elapsed_ms)
                logger.warning(
                    "Timelapse buffered capture timeout after %.0f ms (limit=%.0f ms)",
                    elapsed_ms,
                    self._request_timeout_seconds * 1000.0,
                )
                return False

            frame = self._select_frame_for_target(target_time)
            if frame is None:
                time.sleep(0.003)
                continue

            try:
                frame_path.write_bytes(frame)
            except OSError:
                elapsed_ms = (time.monotonic() - started) * 1000.0
                self._record_capture_duration(elapsed_ms)
                logger.exception("Failed writing timelapse frame to %s", frame_path)
                return False

            elapsed_ms = (time.monotonic() - started) * 1000.0
            self._record_capture_duration(elapsed_ms)
            logger.info("Timelapse buffered capture succeeded in %.0f ms", elapsed_ms)
            return True

        return False

    def _scheduler_loop(self) -> None:
        while not self._pipeline_stop.is_set():
            request: Optional[tuple[int, float, Path]] = None
            with self._pending_lock:
                if self._pending_capture_requests:
                    request = self._pending_capture_requests[0]

            if request is None:
                time.sleep(0.005)
                continue

            request_id, target_time, frame_path = request
            now = time.monotonic()
            if now < target_time:
                time.sleep(min(0.005, target_time - now))
                continue

            success = self._capture_from_buffer(target_time, frame_path)
            self._complete_capture_request(request_id, frame_path, success)

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

        callback = self._on_capture_completed
        if callback is not None:
            try:
                callback(success)
            except Exception:
                logger.exception("Capture-completed callback failed")

        self._finalize_captured_request(request_id, frame_path, success)
        self._mark_frame_finished()

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

    def get_capture_counters(self) -> dict[str, int | float]:
        with self._pending_lock:
            avg_ms = (
                self._capture_duration_sum_ms / self._capture_duration_count
                if self._capture_duration_count > 0
                else 0.0
            )
            return {
                "capture_requests_total": self._capture_requests_total,
                "capture_success_total": self._capture_success_total,
                "capture_fail_total": self._capture_fail_total,
                "capture_duration_last_ms": round(self._capture_duration_last_ms, 1),
                "capture_duration_avg_ms": round(avg_ms, 1),
                "capture_duration_max_ms": round(self._capture_duration_max_ms, 1),
            }

    def _record_capture_duration(self, elapsed_ms: float) -> None:
        with self._pending_lock:
            self._capture_duration_last_ms = elapsed_ms
            self._capture_duration_sum_ms += elapsed_ms
            self._capture_duration_count += 1
            if elapsed_ms > self._capture_duration_max_ms:
                self._capture_duration_max_ms = elapsed_ms

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
