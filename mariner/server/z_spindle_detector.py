import logging
import threading
import time
from datetime import datetime
from typing import Callable, Optional

logger = logging.getLogger(__name__)

try:
    import RPi.GPIO as GPIO
except ImportError:
    GPIO = None


class ZSpindleDetector:
    def __init__(
        self,
        sensor_a_pin: int = 17,
        sensor_b_pin: int = 27,
        led_pin: int = 4,
        debounce_ms: int = 120,
        on_top_detected: Optional[Callable[[], None]] = None,
        top_entry_sensor: str = "A",
    ) -> None:
        self.sensor_a_pin = sensor_a_pin
        self.sensor_b_pin = sensor_b_pin
        self.led_pin = led_pin
        self.debounce_seconds = debounce_ms / 1000.0
        self.on_top_detected = on_top_detected
        self.top_entry_sensor = (
            top_entry_sensor.upper() if top_entry_sensor.upper() in {"A", "B"} else "A"
        )
        self._running = False
        self._thread: Optional[threading.Thread] = None
        self._last_state: tuple[bool, bool] = (False, False)
        self._sequence_index = 0
        self._last_transition: Optional[tuple[tuple[bool, bool], tuple[bool, bool]]] = None
        self._last_trigger = 0.0
        self._top_event_count = 0
        self._last_top_detected_at: Optional[float] = None
        self._last_event_simulated = False

    @property
    def is_running(self) -> bool:
        return self._running

    def setup(self) -> bool:
        if GPIO is None:
            logger.warning("RPi.GPIO unavailable, Z-spindle detector disabled")
            return False
        GPIO.setmode(GPIO.BCM)
        GPIO.setup(self.sensor_a_pin, GPIO.IN, pull_up_down=GPIO.PUD_OFF)
        GPIO.setup(self.sensor_b_pin, GPIO.IN, pull_up_down=GPIO.PUD_OFF)
        GPIO.setup(self.led_pin, GPIO.OUT, initial=GPIO.LOW)
        return True

    def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(target=self._monitor_loop, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._running = False
        if self._thread:
            self._thread.join(timeout=2)
        self._set_led(False)

    def cleanup(self) -> None:
        self.stop()
        if GPIO is not None:
            try:
                GPIO.cleanup([self.sensor_a_pin, self.sensor_b_pin, self.led_pin])
            except Exception:
                logger.exception("GPIO cleanup failed")

    def set_top_entry_sensor(self, sensor: str) -> str:
        normalized = sensor.upper()
        if normalized not in {"A", "B"}:
            normalized = "A"
        self.top_entry_sensor = normalized
        self._sequence_index = 0
        return self.top_entry_sensor

    def _read_state(self) -> tuple[bool, bool]:
        if GPIO is None:
            return self._last_state
        try:
            return bool(GPIO.input(self.sensor_a_pin)), bool(GPIO.input(self.sensor_b_pin))
        except Exception:
            logger.exception("Failed reading Z-spindle sensors")
            return self._last_state

    def _set_led(self, on: bool) -> None:
        if GPIO is None:
            return
        try:
            GPIO.output(self.led_pin, GPIO.HIGH if on else GPIO.LOW)
        except Exception:
            logger.exception("Failed updating Z-spindle LED")

    def _monitor_loop(self) -> None:
        while self._running:
            new_state = self._read_state()
            if self._advance_sequence(new_state):
                now = time.monotonic()
                if now - self._last_trigger >= self.debounce_seconds:
                    self._trigger()
                    self._last_trigger = now
            self._last_transition = (self._last_state, new_state)
            self._last_state = new_state
            time.sleep(0.01)

    def _get_expected_sequence(self) -> tuple[tuple[bool, bool], ...]:
        if self.top_entry_sensor == "A":
            return ((False, False), (True, False), (True, True), (False, True), (False, False))
        return ((False, False), (False, True), (True, True), (True, False), (False, False))

    def _advance_sequence(self, new_state: tuple[bool, bool]) -> bool:
        sequence = self._get_expected_sequence()
        expected = sequence[self._sequence_index]

        if new_state == expected:
            self._sequence_index += 1
            if self._sequence_index >= len(sequence):
                self._sequence_index = 0
                return True
            return False

        if new_state == sequence[0]:
            self._sequence_index = 1
            return False

        self._sequence_index = 0
        return False

    def get_status(self) -> dict:
        sensor_a, sensor_b = self._read_state()
        return {
            "running": self.is_running,
            "gpio_available": GPIO is not None,
            "sensor_a": sensor_a,
            "sensor_b": sensor_b,
            "top_event_count": self._top_event_count,
            "last_top_detected_at": (
                datetime.fromtimestamp(self._last_top_detected_at).isoformat()
                if self._last_top_detected_at is not None
                else None
            ),
            "last_event_simulated": self._last_event_simulated,
            "top_entry_sensor": self.top_entry_sensor,
            "invert": self.top_entry_sensor == "B",
            "last_state": list(self._last_state),
            "sequence_index": self._sequence_index,
            "last_transition": (
                {
                    "from": list(self._last_transition[0]),
                    "to": list(self._last_transition[1]),
                }
                if self._last_transition is not None
                else None
            ),
        }

    def trigger_test_event(self) -> bool:
        self._trigger(simulated=True)
        return True

    def _trigger(self, simulated: bool = False) -> None:
        self._top_event_count += 1
        self._last_top_detected_at = time.time()
        self._last_event_simulated = simulated
        self._set_led(True)
        try:
            if self.on_top_detected:
                self.on_top_detected()
        except Exception:
            logger.exception("Z-top callback failed")
        finally:
            threading.Timer(0.15, lambda: self._set_led(False)).start()
