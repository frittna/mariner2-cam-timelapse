"""Sensor API Routes

Endpoints for:
- DHT22 temperature/humidity readings
- Other environmental sensors
"""

import logging
import board
import adafruit_dht
from flask import Blueprint, jsonify

logger = logging.getLogger(__name__)

sensors_bp = Blueprint("sensors", __name__, url_prefix="/api/sensors")

# DHT22 on GPIO22
try:
    _dht22 = adafruit_dht.DHT22(board.D22, use_pulseio=False)
except Exception as e:
    logger.warning(f"DHT22 sensor not available: {e}")
    _dht22 = None


@sensors_bp.route("/dht22", methods=["GET"])
def get_dht22():
    """Get DHT22 temperature and humidity reading."""
    if not _dht22:
        return jsonify({
            "ok": False,
            "error": "DHT22 sensor not initialized"
        }), 200

    try:
        temp = _dht22.temperature
        hum = _dht22.humidity

        return jsonify({
            "ok": True,
            "temp_c": round(float(temp), 1) if temp is not None else None,
            "hum_pct": round(float(hum), 1) if hum is not None else None,
        })
    except Exception as e:
        logger.error(f"Error reading DHT22: {e}")
        return jsonify({
            "ok": False,
            "error": str(e)
        }), 200
