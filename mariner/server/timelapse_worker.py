import json
import logging
import re
import subprocess
import threading
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Optional

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
        self._executor = ThreadPoolExecutor(
            max_workers=2, thread_name_prefix="timelapse"
        )
        self._lock = threading.Lock()
        self._pending_lock = threading.Lock()
        self._pending_frames = 0
        self._all_frames_done = threading.Event()
        self._all_frames_done.set()
        self._apply_profile_to_mediamtx(self.stream_profile)

    def shutdown(self) -> None:
        self._executor.shutdown(wait=False, cancel_futures=True)

    def set_profile(self, profile: str) -> str:
        with self._lock:
            if profile in PROFILE_TO_STREAM:
                self.stream_profile = profile
                self._apply_profile_to_mediamtx(profile)
            return self.stream_profile

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
        return SESSIONS_DIR / session_id

    def capture_frame(self) -> bool:
        with self._lock:
            if not self.is_recording or not self.current_session_id:
                return False
            self.frame_counter += 1
            session_id = self.current_session_id
            frame_number = self.frame_counter
            profile = self.stream_profile

        frame_path = SESSIONS_DIR / session_id / f"frame_{frame_number:06d}.jpg"
        self._mark_frame_queued()
        try:
            self._executor.submit(self._capture_single_frame, frame_path, profile)
        except RuntimeError:
            self._mark_frame_finished()
            return False
        return True

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

    def _capture_single_frame(self, frame_path: Path, profile: str) -> None:
        stream_path = PROFILE_TO_STREAM.get(profile, PROFILE_TO_STREAM["HIGH"])
        rtsp_url = f"rtsp://{self.mediamtx_host}:{self.mediamtx_port}/{stream_path}"
        cmd = [
            "ffmpeg",
            "-rtsp_transport",
            "tcp",
            "-i",
            rtsp_url,
            "-frames:v",
            "1",
            "-q:v",
            "3",
            "-f",
            "image2",
            str(frame_path),
        ]
        try:
            result = subprocess.run(cmd, capture_output=True, timeout=6, check=False)
            if result.returncode != 0 and frame_path.exists():
                frame_path.unlink()
        except subprocess.TimeoutExpired:
            if frame_path.exists():
                frame_path.unlink()
        finally:
            self._mark_frame_finished()

    @staticmethod
    def _sanitize_session_id(raw: str) -> str:
        cleaned = re.sub(r"[^a-zA-Z0-9._-]", "_", (raw or "").strip())
        return cleaned[:64]

