import os
import time
from typing import Optional

from flask import Blueprint, jsonify, request, send_file

from mariner.server.timelapse_manager import TimelapseManager
from mariner.server.timelapse_worker import (
    PROFILE_TO_STREAM,
    TimelapseWorker,
    get_profile_details,
)
from mariner.server.z_spindle_detector import ZSpindleDetector
from mariner.server.uv_light_detector import UVLightDetector

timelapse_bp = Blueprint("timelapse", __name__, url_prefix="/api/timelapse")

_timelapse_worker: Optional[TimelapseWorker] = None
_z_detector: Optional[ZSpindleDetector] = None
_uv_detector: Optional[UVLightDetector] = None
_trigger_mode = "z_top"
_startup_profile = "HIGH"


def _normalize_trigger_mode(value: str) -> str:
    normalized = str(value or "").strip().lower()
    return normalized if normalized in {"z_top", "uv_light"} else "z_top"


def _apply_trigger_mode(mode: str) -> None:
    global _trigger_mode
    _trigger_mode = _normalize_trigger_mode(mode)

    if _z_detector is not None:
        _z_detector.stop()
    if _uv_detector is not None:
        _uv_detector.stop()

    if _trigger_mode == "uv_light":
        if _uv_detector is not None:
            _uv_detector.start()
    else:
        if _z_detector is not None:
            _z_detector.start()



def init_timelapse() -> None:
    global _timelapse_worker, _z_detector, _uv_detector, _trigger_mode, _startup_profile
    if _timelapse_worker is not None:
        return

    configured_profile = os.getenv("MARINER_TIMELAPSE_PROFILE", "HIGH").upper()
    configured_top_sensor = os.getenv("MARINER_Z_TOP_ENTRY_SENSOR", "A").upper()
    configured_trigger_mode = os.getenv("MARINER_TIMELAPSE_TRIGGER_MODE", "z_top")

    profile = TimelapseManager.get_selected_profile(configured_profile)
    top_sensor = TimelapseManager.get_z_top_entry_sensor(configured_top_sensor)
    trigger_mode = TimelapseManager.get_trigger_mode(configured_trigger_mode)
    _startup_profile = profile

    _timelapse_worker = TimelapseWorker(stream_profile=profile)
    saved_settings = TimelapseManager.load_settings()
    _timelapse_worker.set_capture_settings(
        {
            "capture_offset_ms": saved_settings.get("capture_offset_ms", 120),
            "event_window_ms": saved_settings.get("event_window_ms", 120),
            "buffer_seconds": saved_settings.get("buffer_seconds", 2.0),
            "request_timeout_ms": saved_settings.get("request_timeout_ms", 1000),
            "grabber_fps": saved_settings.get("grabber_fps", 15),
        }
    )

    _z_detector = ZSpindleDetector(
        on_top_detected=_timelapse_worker.capture_frame,
        top_entry_sensor=top_sensor,
    )
    if not _z_detector.setup():
        _z_detector = None

    _uv_detector = UVLightDetector(
        sensor_pin=22,
        on_light_detected=_timelapse_worker.capture_frame,
    )
    if not _uv_detector.setup():
        _uv_detector = None

    _apply_trigger_mode(trigger_mode)


@timelapse_bp.get("/status")
def status():
    worker = _timelapse_worker
    detector = _z_detector if _trigger_mode == "z_top" else _uv_detector
    detector_status = detector.get_status() if detector else None
    detector_z_status = _z_detector.get_status() if _z_detector else None
    detector_uv_status = _uv_detector.get_status() if _uv_detector else None
    capture_counters = worker.get_capture_counters() if worker else {
        "capture_requests_total": 0,
        "capture_success_total": 0,
        "capture_fail_total": 0,
    }
    capture_settings = worker.get_capture_settings() if worker else {
        "capture_offset_ms": 120,
        "event_window_ms": 120,
        "buffer_seconds": 2.0,
        "request_timeout_ms": 1000,
        "grabber_fps": 15,
    }
    return jsonify(
        {
            "ready": worker is not None,
            "recording": bool(worker and worker.is_recording),
            "session_id": worker.current_session_id if worker else None,
            "last_session_id": worker.last_session_id if worker else None,
            "frame_count": worker.frame_counter if worker else 0,
            "pending_frames": worker.get_pending_frames() if worker else 0,
            "capture_requests_total": capture_counters["capture_requests_total"],
            "capture_success_total": capture_counters["capture_success_total"],
            "capture_fail_total": capture_counters["capture_fail_total"],
            "capture_settings": capture_settings,
            "trigger_mode": _trigger_mode,
            "z_detector_running": bool(_z_detector and _z_detector.is_running),
            "uv_detector_running": bool(_uv_detector and _uv_detector.is_running),
            "stream_profile": worker.stream_profile if worker else "HIGH",
            "restart_required": False,
            "detector": detector_status,
            "detector_z": detector_z_status,
            "detector_uv": detector_uv_status,
        }
    )


@timelapse_bp.post("/session/start")
def session_start():
    worker = _timelapse_worker
    if worker is None:
        return jsonify({"error": "Timelapse not initialized"}), 503

    payload = request.get_json(silent=True) or {}
    session_id = payload.get("session_id") or time.strftime("%Y%m%d_%H%M%S")
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
    keep_session = bool(payload.get("keep_session", False))
    if not session_id:
        return jsonify({"error": "session_id required"}), 400

    has_space, disk_info = TimelapseManager.check_disk_space()
    if not has_space:
        return jsonify({"error": "Insufficient disk space", "disk_info": disk_info}), 507

    video = TimelapseManager.render_video(
        session_id, preset=preset, output_name=output_name
    )
    if not video:
        return jsonify({"error": "Render failed"}), 500

    if not keep_session:
        TimelapseManager.cleanup_frames(session_id)
    TimelapseManager.enforce_fifo()
    return jsonify({**video, "keep_session": keep_session})


@timelapse_bp.get("/videos")
def videos():
    return jsonify(TimelapseManager.list_videos())


@timelapse_bp.get("/sessions")
def sessions():
    worker = _timelapse_worker
    active = worker.current_session_id if worker else None
    data = TimelapseManager.list_sessions()
    filtered = []
    for item in data:
        is_active = item["session_id"] == active
        if item.get("frame_count", 0) > 0 or is_active:
            item["active"] = is_active
            filtered.append(item)
    return jsonify(filtered)


@timelapse_bp.route("/sessions/<session_id>", methods=["DELETE", "POST"])
@timelapse_bp.post("/sessions/<session_id>/delete")
def delete_session(session_id: str):
    worker = _timelapse_worker
    if worker and worker.current_session_id == session_id:
        return jsonify({"error": "Cannot delete active session"}), 409

    if TimelapseManager.cleanup_frames(session_id):
        return jsonify({"status": "deleted", "session_id": session_id})
    return jsonify({"error": "Session not found"}), 404


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
    force_download = str(request.args.get("download", "0")).strip().lower() in {"1", "true", "yes", "on"}
    return send_file(target, mimetype="video/mp4", as_attachment=force_download)


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
            "restart_required": False,
            "stream_path": PROFILE_TO_STREAM.get(worker.stream_profile, "cam"),
            "profiles": get_profile_details(),
            "note": "The global cam profile is applied live through the MediaMTX API.",
        }
    )


@timelapse_bp.post("/profiles/<profile>")
def set_profile(profile: str):
    worker = _timelapse_worker
    if worker is None:
        return jsonify({"error": "Timelapse not initialized"}), 503

    current = worker.set_profile(profile.upper())
    TimelapseManager.set_selected_profile(current)

    return jsonify(
        {
            "active": current,
            "available": ["HIGH", "MID", "LOW"],
            "restart_required": False,
            "stream_path": PROFILE_TO_STREAM.get(current, "cam"),
            "profiles": get_profile_details(),
            "note": "Profile applied live: resolution, bitrate, and FPS were updated.",
        }
    )


@timelapse_bp.route("/detector/mode", methods=["GET", "POST"])
def detector_mode():
    global _trigger_mode
    if _timelapse_worker is None:
        return jsonify({"error": "Timelapse not initialized"}), 503

    if request.method == "GET":
        return jsonify({"mode": _trigger_mode})

    payload = request.get_json(silent=True) or {}
    requested = _normalize_trigger_mode(payload.get("mode", _trigger_mode))
    _apply_trigger_mode(requested)
    TimelapseManager.set_trigger_mode(_trigger_mode)
    return jsonify({"mode": _trigger_mode})


@timelapse_bp.route("/detector/invert", methods=["GET", "POST"])
def set_detector_invert():
    detector = _z_detector
    if detector is None:
        return jsonify({"error": "Z-top detector unavailable"}), 503

    payload = request.get_json(silent=True) or {}
    invert_value = payload.get("invert", request.args.get("invert", False))
    invert = str(invert_value).strip().lower() in {"1", "true", "yes", "on"}
    sensor = "B" if invert else "A"
    detector.set_top_entry_sensor(sensor)
    TimelapseManager.set_z_top_entry_sensor(sensor)
    return jsonify(detector.get_status())


@timelapse_bp.post("/test-trigger")
def test_trigger():
    worker = _timelapse_worker
    detector = _z_detector if _trigger_mode == "z_top" else _uv_detector
    if detector is None or worker is None:
        return jsonify({"error": "Timelapse not initialized"}), 503

    detector.trigger_test_event()
    return jsonify(
        {
            "status": "triggered",
            "capture_queued": bool(worker.is_recording),
            "detector": detector.get_status(),
        }
    )


@timelapse_bp.route("/capture-settings", methods=["GET", "POST"])
def capture_settings():
    worker = _timelapse_worker
    if worker is None:
        return jsonify({"error": "Timelapse not initialized"}), 503

    if request.method == "GET":
        return jsonify(worker.get_capture_settings())

    payload = request.get_json(silent=True) or {}
    allowed = {
        "capture_offset_ms",
        "event_window_ms",
        "buffer_seconds",
        "request_timeout_ms",
        "grabber_fps",
    }
    updates = {k: payload[k] for k in allowed if k in payload}
    current = worker.set_capture_settings(updates)

    persisted = TimelapseManager.load_settings()
    persisted.update(current)
    TimelapseManager.save_settings(persisted)

    return jsonify(current)


@timelapse_bp.post("/storage/fifo")
def run_fifo():
    payload = request.get_json(silent=True) or {}
    max_storage_mb = int(payload.get("max_storage_mb", 2048))
    return jsonify(TimelapseManager.enforce_fifo(max_storage_mb=max_storage_mb))




