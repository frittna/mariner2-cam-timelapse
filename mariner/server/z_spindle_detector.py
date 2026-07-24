import logging
import shutil
import subprocess
import threading
import time
from datetime import datetime
from pathlib import Path
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
        led_pin: int = 26,
        debounce_ms: int = 15,
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
        self._last_transition: Optional[tuple[tuple[bool, bool], tuple[bool, bool]]] = None
        self._last_trigger = 0.0
        self._top_event_count = 0
        self._last_top_detected_at: Optional[float] = None
        self._last_event_simulated = False
        self._last_revolution_direction: Optional[str] = None
        self._quadrature_sum = 0
        self._quadrature_edges = 0

        self._state_lock = threading.Lock()
        self._use_interrupts = False
        self._interrupt_backend = "none"
        self._interrupt_stop = threading.Event()

        self._led_available = False

        self._gpiomon_processes: dict[int, subprocess.Popen[str]] = {}
        self._gpiomon_threads: list[threading.Thread] = []

    @property
    def is_running(self) -> bool:
        return self._running

    def setup(self) -> bool:
        if GPIO is None:
            logger.warning("RPi.GPIO unavailable, Z-spindle detector disabled")
            return False

        GPIO.setwarnings(False)
        GPIO.setmode(GPIO.BCM)

        for pin in (self.sensor_a_pin, self.sensor_b_pin):
            try:
                GPIO.remove_event_detect(pin)
            except Exception:
                pass

        try:
            GPIO.cleanup([self.sensor_a_pin, self.sensor_b_pin, self.led_pin])
        except Exception:
            pass

        GPIO.setup(self.sensor_a_pin, GPIO.IN, pull_up_down=GPIO.PUD_OFF)
        GPIO.setup(self.sensor_b_pin, GPIO.IN, pull_up_down=GPIO.PUD_OFF)

        try:
            GPIO.setup(self.led_pin, GPIO.OUT, initial=GPIO.LOW)
            self._led_available = True
        except Exception:
            self._led_available = False
            logger.warning("Failed to initialize Z-spindle LED pin %s", self.led_pin)

        self._last_state = self._read_state()
        self._quadrature_sum = 0
        self._quadrature_edges = 0
        self._last_revolution_direction = None
        self._interrupt_stop.clear()
        self._use_interrupts = self._register_interrupts()

        if self._use_interrupts:
            logger.info(
                "Z-spindle detector using interrupt mode (%s)", self._interrupt_backend
            )
        else:
            logger.warning("Z-spindle interrupt setup failed, falling back to polling mode")

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

        self._set_led(False)

    def cleanup(self) -> None:
        self.stop()
        if self._use_interrupts or self._interrupt_backend != "none":
            self._unregister_interrupts()
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
        self._last_revolution_direction = None
        self._quadrature_sum = 0
        self._quadrature_edges = 0
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
        if GPIO is None or not self._led_available:
            return
        try:
            GPIO.output(self.led_pin, GPIO.HIGH if on else GPIO.LOW)
        except Exception:
            logger.exception("Failed updating Z-spindle LED")

    def _register_interrupts(self) -> bool:
        if self._register_gpiomon_interrupts():
            self._interrupt_backend = "gpiomon"
            return True

        if self._register_rpi_interrupts():
            self._interrupt_backend = "rpi_gpio"
            return True

        self._interrupt_backend = "none"
        return False

    def _register_gpiomon_interrupts(self) -> bool:
        gpiomon_bin = shutil.which("gpiomon") or "/usr/bin/gpiomon"
        if not Path(gpiomon_bin).exists():
            return False

        processes: dict[int, subprocess.Popen[str]] = {}
        threads: list[threading.Thread] = []

        try:
            for pin in (self.sensor_a_pin, self.sensor_b_pin):
                process = subprocess.Popen(
                    [gpiomon_bin, "--chip", "gpiochip0", f"GPIO{pin}"],
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                    bufsize=1,
                )
                processes[pin] = process
                thread = threading.Thread(
                    target=self._gpiomon_reader_loop,
                    args=(pin, process),
                    daemon=True,
                    name=f"z-spindle-gpiomon-{pin}",
                )
                thread.start()
                threads.append(thread)

            self._gpiomon_processes = processes
            self._gpiomon_threads = threads
            return True
        except Exception:
            logger.exception("Failed to start gpiomon interrupt backend")
            for process in processes.values():
                try:
                    process.terminate()
                except Exception:
                    pass
            return False

    def _register_rpi_interrupts(self) -> bool:
        if GPIO is None:
            return False

        armed_pins: list[int] = []
        for pin in (self.sensor_a_pin, self.sensor_b_pin):
            try:
                GPIO.add_event_detect(
                    pin,
                    GPIO.BOTH,
                    callback=self._on_gpio_edge,
                    bouncetime=2,
                )
                armed_pins.append(pin)
            except Exception:
                logger.exception("Failed to add edge detection for pin %s", pin)
                for armed_pin in armed_pins:
                    try:
                        GPIO.remove_event_detect(armed_pin)
                    except Exception:
                        pass
                return False

        return True

    def _unregister_interrupts(self) -> None:
        self._interrupt_stop.set()

        if self._interrupt_backend == "rpi_gpio" and GPIO is not None:
            for pin in (self.sensor_a_pin, self.sensor_b_pin):
                try:
                    GPIO.remove_event_detect(pin)
                except Exception:
                    pass

        if self._interrupt_backend == "gpiomon":
            for process in self._gpiomon_processes.values():
                try:
                    process.terminate()
                except Exception:
                    pass

            for process in self._gpiomon_processes.values():
                try:
                    process.wait(timeout=1.0)
                except Exception:
                    try:
                        process.kill()
                    except Exception:
                        pass

            self._gpiomon_processes = {}

            for thread in self._gpiomon_threads:
                thread.join(timeout=0.5)
            self._gpiomon_threads = []

        self._interrupt_backend = "none"
        self._use_interrupts = False

    def _gpiomon_reader_loop(self, pin: int, process: subprocess.Popen[str]) -> None:
        stdout = process.stdout
        if stdout is None:
            return

        while not self._interrupt_stop.is_set() and process.poll() is None:
            line = stdout.readline()
            if not line:
                break
            self._on_gpio_edge(pin)

        stderr = process.stderr
        if stderr is not None:
            try:
                err = stderr.read(500).strip()
            except Exception:
                err = ""
            if err:
                logger.warning("gpiomon stderr on pin %s: %s", pin, err)

    @staticmethod
    def _is_single_bit_transition(
        old_state: tuple[bool, bool], new_state: tuple[bool, bool]
    ) -> bool:
        changed_bits = 0
        if old_state[0] != new_state[0]:
            changed_bits += 1
        if old_state[1] != new_state[1]:
            changed_bits += 1
        return changed_bits == 1

    @staticmethod
    def _transition_delta(
        old_state: tuple[bool, bool], new_state: tuple[bool, bool]
    ) -> int:
        order = {
            (False, False): 0,
            (False, True): 1,
            (True, True): 2,
            (True, False): 3,
        }
        old_idx = order[old_state]
        new_idx = order[new_state]
        diff = (new_idx - old_idx) % 4
        if diff == 1:
            return 1
        if diff == 3:
            return -1
        return 0

    def _complete_cycle_and_check_trigger(self) -> bool:
        trigger = False
        if self._quadrature_edges >= 4 and abs(self._quadrature_sum) >= 4:
            cycle_direction = "down" if self._quadrature_sum > 0 else "up"
            trigger = (
                cycle_direction == "down" and self._last_revolution_direction == "up"
            )
            self._last_revolution_direction = cycle_direction
        self._quadrature_sum = 0
        self._quadrature_edges = 0
        return trigger

    def _on_gpio_edge(self, _channel: int) -> None:
        if not self._running:
            return
        with self._state_lock:
            self._process_state_change(self._read_state())

    def _monitor_loop(self) -> None:
        while self._running:
            with self._state_lock:
                self._process_state_change(self._read_state())
            time.sleep(0.001)

    def _process_state_change(self, new_state: tuple[bool, bool]) -> None:
        if new_state == self._last_state:
            return

        if not self._is_single_bit_transition(self._last_state, new_state):
            self._last_transition = (self._last_state, new_state)
            self._quadrature_sum = 0
            self._quadrature_edges = 0
            return

        delta = self._transition_delta(self._last_state, new_state)
        if self.top_entry_sensor == "B":
            delta *= -1

        self._quadrature_sum += delta
        self._quadrature_edges += 1

        if new_state == (False, False) and self._complete_cycle_and_check_trigger():
            now = time.monotonic()
            if now - self._last_trigger >= self.debounce_seconds:
                self._trigger()
                self._last_trigger = now

        self._last_transition = (self._last_state, new_state)
        self._last_state = new_state

    def get_status(self) -> dict:
        sensor_a, sensor_b = self._read_state()
        return {
            "running": self.is_running,
            "gpio_available": GPIO is not None,
            "interrupt_mode": self._use_interrupts,
            "interrupt_backend": self._interrupt_backend,
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
            "last_revolution_direction": self._last_revolution_direction,
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
