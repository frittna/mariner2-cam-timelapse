import os
import time
from typing import Optional

from flask import Blueprint, jsonify, request, send_file

from mariner.server.timelapse_manager import TimelapseManager
from mariner.server.timelapse_worker import TimelapseWorker
from mariner.server.z_spindle_detector import ZSpindleDetector

timelapse_bp = Blueprint("timelapse", __name__, url_prefix="/api/timelapse")

_timelapse_worker: Optional[TimelapseWorker] = None
_z_detector: Optional[ZSpindleDetector] = None


def init_timelapse() -> None:
    global _timelapse_worker, _z_detector
    if _timelapse_worker is not None:
        return

    profile = os.getenv("MARINER_TIMELAPSE_PROFILE", "HIGH").upper()
    _timelapse_worker = TimelapseWorker(stream_profile=profile)
    _z_detector = ZSpindleDetector(on_top_detected=_timelapse_worker.capture_frame)
    if _z_detector.setup():
        _z_detector.start()


@timelapse_bp.get("/status")
def status():
    worker = _timelapse_worker
    detector = _z_detector
    return jsonify(
        {
            "ready": worker is not None,
            "recording": bool(worker and worker.is_recording),
            "session_id": worker.current_session_id if worker else None,
            "frame_count": worker.frame_counter if worker else 0,
            "z_detector_running": detector.is_running if detector else False,
            "stream_profile": worker.stream_profile if worker else "HIGH",
        }
    )


@timelapse_bp.post("/session/start")
def session_start():
    worker = _timelapse_worker
    if worker is None:
        return jsonify({"error": "Timelapse not initialized"}), 503

    payload = request.get_json(silent=True) or {}
    session_id = payload.get("session_id") or f"session_{int(time.time())}"
    started_id = worker.start_session(session_id)
    if started_id is None:
        return jsonify({"error": "Session already active or invalid id"}), 409
    return jsonify({"status": "started", "session_id": started_id})


@timelapse_bp.post("/session/end")
def session_end():
    worker = _timelapse_worker
    if worker is None:
        return jsonify({"error": "Timelapse not initialized"}), 503

    session_dir = worker.end_session()
    if session_dir is None:
        return jsonify({"error": "No active session"}), 409

    info = TimelapseManager.list_videos()
    return jsonify({"status": "ended", "session_id": session_dir.name, "videos": info})


@timelapse_bp.post("/capture")
def capture():
    worker = _timelapse_worker
    if worker is None:
        return jsonify({"error": "Timelapse not initialized"}), 503
    if not worker.capture_frame():
        return jsonify({"error": "No active session"}), 409
    return jsonify({"status": "queued"})


@timelapse_bp.post("/render")
def render():
    payload = request.get_json(silent=True) or {}
    session_id = payload.get("session_id")
    preset = payload.get("preset", "normal_30fps")
    output_name = payload.get("output_name")
    if not session_id:
        return jsonify({"error": "session_id required"}), 400

    has_space, disk_info = TimelapseManager.check_disk_space()
    if not has_space:
        return jsonify({"error": "Insufficient disk space", "disk_info": disk_info}), 507

    video = TimelapseManager.render_video(session_id, preset=preset, output_name=output_name)
    if not video:
        return jsonify({"error": "Render failed"}), 500

    TimelapseManager.cleanup_frames(session_id)
    TimelapseManager.enforce_fifo()
    return jsonify(video)


@timelapse_bp.get("/videos")
def videos():
    return jsonify(TimelapseManager.list_videos())


@timelapse_bp.delete("/videos/<filename>")
def delete_video(filename: str):
    if TimelapseManager.delete_video(filename):
        return jsonify({"status": "deleted", "filename": filename})
    return jsonify({"error": "Video not found"}), 404


@timelapse_bp.get("/videos/<filename>")
def get_video(filename: str):
    from mariner.server.timelapse_manager import VIDEOS_DIR

    target = (VIDEOS_DIR / filename).resolve()
    try:
        target.relative_to(VIDEOS_DIR.resolve())
    except ValueError:
        return jsonify({"error": "Invalid filename"}), 400
    if not target.exists() or not target.is_file():
        return jsonify({"error": "Video not found"}), 404
    return send_file(target, mimetype="video/mp4", as_attachment=False)


@timelapse_bp.get("/disk-space")
def disk_space():
    enough, info = TimelapseManager.check_disk_space()
    info["sufficient"] = enough
    return jsonify(info)


@timelapse_bp.get("/profiles")
def profiles():
    worker = _timelapse_worker
    if worker is None:
        return jsonify({"error": "Timelapse not initialized"}), 503
    return jsonify(
        {
            "active": worker.stream_profile,
            "available": ["HIGH", "MID", "LOW"],
        }
    )


@timelapse_bp.post("/profiles/<profile>")
def set_profile(profile: str):
    worker = _timelapse_worker
    if worker is None:
        return jsonify({"error": "Timelapse not initialized"}), 503
    current = worker.set_profile(profile.upper())
    return jsonify({"active": current})


@timelapse_bp.post("/storage/fifo")
def run_fifo():
    payload = request.get_json(silent=True) or {}
    max_storage_mb = int(payload.get("max_storage_mb", 2048))
    return jsonify(TimelapseManager.enforce_fifo(max_storage_mb=max_storage_mb))
