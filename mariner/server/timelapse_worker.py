import logging
import re
import subprocess
import threading
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


class TimelapseWorker:
    def __init__(
        self,
        mediamtx_host: str = "localhost",
        mediamtx_port: int = 8554,
        stream_profile: str = "HIGH",
    ) -> None:
        self.mediamtx_host = mediamtx_host
        self.mediamtx_port = mediamtx_port
        self.stream_profile = stream_profile if stream_profile in PROFILE_TO_STREAM else "HIGH"
        self.current_session_id: Optional[str] = None
        self.frame_counter = 0
        self.is_recording = False
        self._executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="timelapse")
        self._lock = threading.Lock()

    def shutdown(self) -> None:
        self._executor.shutdown(wait=False, cancel_futures=True)

    def set_profile(self, profile: str) -> str:
        with self._lock:
            if profile in PROFILE_TO_STREAM:
                self.stream_profile = profile
            return self.stream_profile

    def start_session(self, session_id: str) -> Optional[str]:
        cleaned = self._sanitize_session_id(session_id)
        if not cleaned:
            return None

        with self._lock:
            if self.is_recording:
                return None
            (SESSIONS_DIR / cleaned).mkdir(parents=True, exist_ok=True)
            self.current_session_id = cleaned
            self.frame_counter = 0
            self.is_recording = True
        return cleaned

    def end_session(self) -> Optional[Path]:
        with self._lock:
            if not self.is_recording or not self.current_session_id:
                return None
            session_id = self.current_session_id
            self.is_recording = False
            self.current_session_id = None
            self.frame_counter = 0
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
        self._executor.submit(self._capture_single_frame, frame_path, profile)
        return True

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

    @staticmethod
    def _sanitize_session_id(raw: str) -> str:
        cleaned = re.sub(r"[^a-zA-Z0-9._-]", "_", (raw or "").strip())
        return cleaned[:64]
