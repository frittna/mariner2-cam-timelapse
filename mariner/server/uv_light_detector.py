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
        sensor_pin: int = 24,
        debounce_ms: int = 300,
        on_light_detected: Optional[Callable[[], None]] = None,
        poll_interval_ms: int = 5,
        led_pin: int = 26,
    ) -> None:
        self.sensor_pin = sensor_pin
        self.debounce_seconds = debounce_ms / 1000.0
        self.on_light_detected = on_light_detected
        self._poll_interval_seconds = max(0.001, poll_interval_ms / 1000.0)
        self.led_pin = led_pin

        self._running = False
        self._thread: Optional[threading.Thread] = None

        self._use_interrupts = False
        self._interrupt_backend = "polling"

        self._last_state = False
        self._latched_high = False
        self._last_trigger = 0.0
        self._event_count = 0
        self._last_detected_at: Optional[float] = None
        self._state_lock = threading.Lock()

        self._led_available = False

    @property
    def is_running(self) -> bool:
        return self._running

    def setup(self) -> bool:
        if GPIO is None:
            logger.warning("RPi.GPIO unavailable, UV detector disabled")
            return False

        GPIO.setwarnings(False)
        GPIO.setmode(GPIO.BCM)
        GPIO.setup(self.sensor_pin, GPIO.IN, pull_up_down=GPIO.PUD_OFF)

        try:
            GPIO.setup(self.led_pin, GPIO.OUT, initial=GPIO.LOW)
            self._led_available = True
        except Exception:
            self._led_available = False
            logger.warning("Failed to initialize UV trigger LED pin %s", self.led_pin)

        self._last_state = self._read_state()
        self._latched_high = self._last_state
        self._interrupt_backend = "polling"
        self._use_interrupts = False
        logger.info(
            "UV detector using polling mode on pin %s (interval=%.1f ms)",
            self.sensor_pin,
            self._poll_interval_seconds * 1000.0,
        )
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
            self._thread = None

        self._set_led(False)

    def cleanup(self) -> None:
        self.stop()
        if GPIO is not None:
            try:
                GPIO.cleanup([self.sensor_pin, self.led_pin])
            except Exception:
                logger.exception("UV GPIO cleanup failed")

    def _read_state(self) -> bool:
        if GPIO is None:
            return self._last_state
        try:
            return bool(GPIO.input(self.sensor_pin))
        except Exception:
            logger.exception("Failed reading UV sensor")
            return self._last_state

    def _set_led(self, on: bool) -> None:
        if GPIO is None or not self._led_available:
            return
        try:
            GPIO.output(self.led_pin, GPIO.HIGH if on else GPIO.LOW)
        except Exception:
            logger.exception("Failed updating UV trigger LED")


    def pulse_capture_led(self) -> None:
        self._set_led(True)
        threading.Timer(0.15, lambda: self._set_led(False)).start()

    def _monitor_loop(self) -> None:
        while self._running:
            with self._state_lock:
                self._process_state_change(self._read_state())
            time.sleep(self._poll_interval_seconds)

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
            "interrupt_backend": self._interrupt_backend,
            "sensor_high": self._read_state(),
            "event_count": self._event_count,
            "last_detected_at": (
                datetime.fromtimestamp(self._last_detected_at).isoformat()
                if self._last_detected_at is not None
                else None
            ),
            "pin": self.sensor_pin,
            "poll_interval_ms": round(self._poll_interval_seconds * 1000.0, 1),
            "led_pin": self.led_pin,
        }

    def trigger_test_event(self) -> bool:
        self._trigger_if_allowed()
        return True
