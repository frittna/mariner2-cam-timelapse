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


class UVLightDetector:
    def __init__(
        self,
        sensor_pin: int = 22,
        debounce_ms: int = 300,
        on_light_detected: Optional[Callable[[], None]] = None,
    ) -> None:
        self.sensor_pin = sensor_pin
        self.debounce_seconds = debounce_ms / 1000.0
        self.on_light_detected = on_light_detected
        self._running = False
        self._thread: Optional[threading.Thread] = None
        self._use_interrupts = False
        self._last_state = False
        self._latched_high = False
        self._last_trigger = 0.0
        self._event_count = 0
        self._last_detected_at: Optional[float] = None
        self._state_lock = threading.Lock()

    @property
    def is_running(self) -> bool:
        return self._running

    def setup(self) -> bool:
        if GPIO is None:
            logger.warning("RPi.GPIO unavailable, UV detector disabled")
            return False

        GPIO.setmode(GPIO.BCM)
        GPIO.setup(self.sensor_pin, GPIO.IN, pull_up_down=GPIO.PUD_OFF)
        self._last_state = self._read_state()
        self._use_interrupts = False
        logger.info("UV detector using polling on pin %s", self.sensor_pin)

        return True

    def start(self) -> None:
        if self._running:
            return
        self._running = True

        if not self._use_interrupts:
            self._thread = threading.Thread(target=self._monitor_loop, daemon=True)
            self._thread.start()

    def stop(self) -> None:
        self._running = False
        if self._thread:
            self._thread.join(timeout=2)
            self._thread = None

    def cleanup(self) -> None:
        self.stop()
        if GPIO is not None and self._use_interrupts:
            try:
                GPIO.remove_event_detect(self.sensor_pin)
            except Exception:
                logger.exception("Failed removing UV GPIO edge detection")

    def _read_state(self) -> bool:
        if GPIO is None:
            return self._last_state
        try:
            return bool(GPIO.input(self.sensor_pin))
        except Exception:
            logger.exception("Failed reading UV sensor")
            return self._last_state

    def _on_gpio_edge(self, _channel: int) -> None:
        if not self._running:
            return
        with self._state_lock:
            self._process_state_change(self._read_state())

    def _monitor_loop(self) -> None:
        while self._running:
            with self._state_lock:
                self._process_state_change(self._read_state())
            time.sleep(0.01)

    def _process_state_change(self, state: bool) -> None:
        if not state:
            self._latched_high = False
            self._last_state = False
            return

        if self._latched_high:
            self._last_state = True
            return

        self._trigger_if_allowed()
        self._last_state = True

    def _trigger_if_allowed(self) -> None:
        now = time.monotonic()
        if now - self._last_trigger < self.debounce_seconds:
            return
        self._last_trigger = now
        self._latched_high = True
        self._event_count += 1
        self._last_detected_at = time.time()
        try:
            if self.on_light_detected:
                self.on_light_detected()
        except Exception:
            logger.exception("UV-light callback failed")

    def get_status(self) -> dict:
        return {
            "running": self.is_running,
            "gpio_available": GPIO is not None,
            "interrupt_mode": self._use_interrupts,
            "sensor_high": self._read_state(),
            "event_count": self._event_count,
            "last_detected_at": (
                datetime.fromtimestamp(self._last_detected_at).isoformat()
                if self._last_detected_at is not None
                else None
            ),
            "pin": self.sensor_pin,
        }

    def trigger_test_event(self) -> bool:
        self._trigger_if_allowed()
        return True
