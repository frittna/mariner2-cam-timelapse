import unittest
from mariner.server.z_spindle_detector import ZSpindleDetector


def simulate_revolution(detector, direction: str) -> list[bool]:
    """Simulate one full revolution and return list of trigger results."""
    if detector.top_entry_sensor == "A":
        if direction == "down":
            states = [(False, True), (True, True), (True, False), (False, False)]
        else:
            states = [(True, False), (True, True), (False, True), (False, False)]
    else:
        if direction == "down":
            states = [(True, False), (True, True), (False, True), (False, False)]
        else:
            states = [(False, True), (True, True), (True, False), (False, False)]

    results = []
    for state in states:
        triggered = detector._check_direction_change_to_down(state)
        detector._last_state = state
        results.append(triggered)
    return results


class ZSpindleDetectorTest(unittest.TestCase):

    def test_up_then_down_triggers_once(self) -> None:
        d = ZSpindleDetector()
        # Three upward revolutions: no trigger
        for _ in range(3):
            results = simulate_revolution(d, "up")
            self.assertFalse(any(results), "Up should never trigger")
        # First downward revolution after going up: TRIGGER
        results = simulate_revolution(d, "down")
        self.assertTrue(any(results), "First down after up must trigger")
        # More downward revolutions: no more triggers
        for _ in range(3):
            results = simulate_revolution(d, "down")
            self.assertFalse(any(results), "Continued down must not trigger again")

    def test_down_then_up_no_trigger(self) -> None:
        d = ZSpindleDetector()
        simulate_revolution(d, "up")  # set direction to up first
        simulate_revolution(d, "down")  # triggers once
        # Now upward: no trigger
        for _ in range(5):
            results = simulate_revolution(d, "up")
            self.assertFalse(any(results), "Up should never trigger")

    def test_alternating_triggers_once_each_down_start(self) -> None:
        d = ZSpindleDetector()
        simulate_revolution(d, "up")
        # down start: triggers
        r = simulate_revolution(d, "down")
        self.assertTrue(any(r))
        # more down: no trigger
        r = simulate_revolution(d, "down")
        self.assertFalse(any(r))
        # back up: no trigger
        r = simulate_revolution(d, "up")
        self.assertFalse(any(r))
        # down again: triggers
        r = simulate_revolution(d, "down")
        self.assertTrue(any(r))

    def test_inverted_mode(self) -> None:
        d = ZSpindleDetector(top_entry_sensor="B")
        simulate_revolution(d, "up")
        r = simulate_revolution(d, "down")
        self.assertTrue(any(r), "Inverted: first down after up must trigger")
        r = simulate_revolution(d, "down")
        self.assertFalse(any(r), "Inverted: continued down must not trigger")

    def test_invalid_sensor_falls_back_to_a(self) -> None:
        d = ZSpindleDetector(top_entry_sensor="X")
        self.assertEqual(d.top_entry_sensor, "A")


if __name__ == "__main__":
    unittest.main()
