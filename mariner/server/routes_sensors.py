import logging
from typing import Optional

from flask import Blueprint, jsonify

logger = logging.getLogger(__name__)
sensors_bp = Blueprint("sensors", __name__, url_prefix="/api/sensors")


def _read_bmp280_temperature() -> tuple[Optional[float], Optional[str]]:
    try:
        import board
        import busio
        import adafruit_bmp280
    except Exception as exc:
        return None, f"bmp280-import-failed: {exc}"

    try:
        i2c = busio.I2C(board.SCL, board.SDA)
        sensor = adafruit_bmp280.Adafruit_BMP280_I2C(i2c, address=0x76)
        return float(sensor.temperature), None
    except Exception as exc:
        return None, f"bmp280-read-failed: {exc}"


@sensors_bp.get("/bmp280")
def bmp280_temperature():
    temp_c, error = _read_bmp280_temperature()
    if temp_c is None:
        logger.warning("BMP280 unavailable: %s", error)
        return jsonify({"ok": False, "sensor": "BMP280", "temp_c": None, "error": error}), 200
    return jsonify({"ok": True, "sensor": "BMP280", "temp_c": round(temp_c, 2)}), 200
