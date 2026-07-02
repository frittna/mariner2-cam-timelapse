import unittest

from mariner.server.z_spindle_detector import ZSpindleDetector


class ZSpindleDetectorTest(unittest.TestCase):
    def test_default_top_event_uses_sensor_a_transition(self) -> None:
        detector = ZSpindleDetector()

        self.assertTrue(detector._is_top_event((True, False), (True, True)))
        self.assertFalse(detector._is_top_event((False, True), (True, True)))

    def test_sensor_b_mode_uses_the_opposite_transition(self) -> None:
        detector = ZSpindleDetector(top_entry_sensor="B")

        self.assertTrue(detector._is_top_event((False, True), (True, True)))
        self.assertFalse(detector._is_top_event((True, False), (True, True)))

    def test_invalid_top_entry_sensor_falls_back_to_a(self) -> None:
        detector = ZSpindleDetector(top_entry_sensor="invalid")

        self.assertEqual(detector.top_entry_sensor, "A")
        self.assertEqual(detector._top_entry_state(), (True, False))


if __name__ == "__main__":
    unittest.main()
