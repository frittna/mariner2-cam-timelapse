import json
import shutil
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Dict, Optional, Tuple

BASE_DIR = Path("/var/tmp/mariner_timelapse")
SESSIONS_DIR = BASE_DIR / "sessions"
VIDEOS_DIR = BASE_DIR / "videos"
SETTINGS_FILE = BASE_DIR / "settings.json"
SESSIONS_DIR.mkdir(parents=True, exist_ok=True)
VIDEOS_DIR.mkdir(parents=True, exist_ok=True)


class TimelapseManager:
    RENDER_PRESETS: Dict[str, Dict[str, int | str]] = {
        "smooth_60fps": {"fps": 60, "preset": "ultrafast", "crf": 26},
        "normal_30fps": {"fps": 30, "preset": "ultrafast", "crf": 28},
        "cinematic_25fps": {"fps": 25, "preset": "superfast", "crf": 30},
    }

    @staticmethod
    def list_videos() -> list[dict]:
        output = []
        for path in sorted(VIDEOS_DIR.glob("*.mp4"), key=lambda p: p.stat().st_mtime, reverse=True):
            stat = path.stat()
            output.append(
                {
                    "filename": path.name,
                    "size_mb": round(stat.st_size / (1024 * 1024), 2),
                    "created_at": datetime.fromtimestamp(stat.st_ctime).isoformat(),
                    "modified_at": datetime.fromtimestamp(stat.st_mtime).isoformat(),
                }
            )
        return output

    @staticmethod
    def load_settings() -> dict:
        if not SETTINGS_FILE.exists():
            return {}
        try:
            return json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {}

    @staticmethod
    def save_settings(settings: dict) -> dict:
        SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
        SETTINGS_FILE.write_text(json.dumps(settings, indent=2, sort_keys=True), encoding="utf-8")
        return settings

    @classmethod
    def get_selected_profile(cls, default: str = "HIGH") -> str:
        profile = str(cls.load_settings().get("profile", default)).upper()
        return profile if profile in {"HIGH", "MID", "LOW"} else default

    @classmethod
    def set_selected_profile(cls, profile: str) -> str:
        normalized = profile.upper()
        if normalized not in {"HIGH", "MID", "LOW"}:
            normalized = "HIGH"
        cls.save_settings({"profile": normalized})
        return normalized

    @staticmethod
    def write_session_metadata(session_id: str, metadata: dict) -> None:
        session_dir = SESSIONS_DIR / session_id
        session_dir.mkdir(parents=True, exist_ok=True)
        (session_dir / "session.json").write_text(
            json.dumps(metadata, indent=2, sort_keys=True),
            encoding="utf-8",
        )

    @staticmethod
    def read_session_metadata(session_id: str) -> dict:
        metadata_path = SESSIONS_DIR / session_id / "session.json"
        if not metadata_path.exists():
            return {}
        try:
            return json.loads(metadata_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {}

    @staticmethod
    def check_disk_space(min_free_gb: float = 1.0) -> Tuple[bool, dict]:
        usage = shutil.disk_usage(BASE_DIR)
        free_gb = usage.free / (1024**3)
        total_gb = usage.total / (1024**3)
        used_gb = usage.used / (1024**3)
        return free_gb > min_free_gb, {
            "free_gb": round(free_gb, 2),
            "used_gb": round(used_gb, 2),
            "total_gb": round(total_gb, 2),
            "used_percent": round((used_gb / total_gb) * 100, 1),
        }

    @classmethod
    def render_video(
        cls,
        session_id: str,
        preset: str = "normal_30fps",
        output_name: Optional[str] = None,
    ) -> Optional[dict]:
        session_dir = SESSIONS_DIR / session_id
        if not session_dir.exists():
            return None

        frame_count = len(list(session_dir.glob("frame_*.jpg")))
        if frame_count == 0:
            return None

        if preset not in cls.RENDER_PRESETS:
            preset = "normal_30fps"
        preset_data = cls.RENDER_PRESETS[preset]
        session_metadata = cls.read_session_metadata(session_id)

        if not output_name:
            output_name = f"timelapse_{session_id}_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        output_path = VIDEOS_DIR / f"{output_name}.mp4"

        cmd = [
            "ffmpeg",
            "-y",
            "-framerate",
            str(preset_data["fps"]),
            "-i",
            str(session_dir / "frame_%06d.jpg"),
            "-c:v",
            "libx264",
            "-preset",
            str(preset_data["preset"]),
            "-crf",
            str(preset_data["crf"]),
            "-pix_fmt",
            "yuv420p",
            str(output_path),
        ]

        try:
            subprocess.run(cmd, capture_output=True, check=True, timeout=600)
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
            if output_path.exists():
                output_path.unlink()
            return None

        return {
            "filename": output_path.name,
            "size_mb": round(output_path.stat().st_size / (1024 * 1024), 2),
            "frame_count": frame_count,
            "fps": int(preset_data["fps"]),
            "preset": preset,
            "capture_profile": session_metadata.get("stream_profile"),
            "stream_path": session_metadata.get("stream_path"),
            "created_at": datetime.now().isoformat(),
        }

    @staticmethod
    def cleanup_frames(session_id: str) -> bool:
        target = SESSIONS_DIR / session_id
        if not target.exists():
            return True
        shutil.rmtree(target)
        return True

    @staticmethod
    def delete_video(filename: str) -> bool:
        target = (VIDEOS_DIR / filename).resolve()
        try:
            target.relative_to(VIDEOS_DIR.resolve())
        except ValueError:
            return False
        if not target.exists() or not target.is_file():
            return False
        target.unlink()
        return True

    @staticmethod
    def enforce_fifo(max_storage_mb: int = 2048) -> dict:
        max_bytes = max_storage_mb * 1024 * 1024
        files = [f for f in BASE_DIR.rglob("*") if f.is_file()]
        files.sort(key=lambda p: p.stat().st_mtime)
        total_size = sum(f.stat().st_size for f in files)
        removed = 0

        while total_size > max_bytes and files:
            oldest = files.pop(0)
            size = oldest.stat().st_size
            oldest.unlink(missing_ok=True)
            total_size -= size
            removed += 1

        return {
            "max_storage_mb": max_storage_mb,
            "current_storage_mb": round(total_size / (1024 * 1024), 2),
            "removed_files": removed,
        }
