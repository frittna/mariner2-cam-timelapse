import unittest

from mariner.server.z_spindle_detector import ZSpindleDetector


class ZSpindleDetectorTest(unittest.TestCase):
    def test_default_mode_up_to_down_triggers(self) -> None:
        # Mode A: A on = up, B on = down. Only up->down triggers.
        detector = ZSpindleDetector()

        self.assertFalse(detector._check_direction_change((True, False)))
        self.assertFalse(detector._check_direction_change((True, True)))
        self.assertFalse(detector._check_direction_change((True, False)))
        self.assertTrue(detector._check_direction_change((False, True)))

    def test_default_mode_down_to_up_no_trigger(self) -> None:
        # Mode A: down->up does NOT trigger
        detector = ZSpindleDetector()

        self.assertFalse(detector._check_direction_change((False, True)))
        self.assertFalse(detector._check_direction_change((True, True)))
        self.assertFalse(detector._check_direction_change((False, True)))
        self.assertFalse(detector._check_direction_change((True, False)))

    def test_same_direction_no_trigger(self) -> None:
        # Stay moving up
        detector = ZSpindleDetector()

        self.assertFalse(detector._check_direction_change((True, False)))
        self.assertFalse(detector._check_direction_change((True, True)))
        self.assertFalse(detector._check_direction_change((True, False)))
        self.assertFalse(detector._check_direction_change((True, True)))

    def test_inverted_mode_up_to_down_triggers(self) -> None:
        # Mode B: B on = up, A on = down. Only up->down triggers.
        detector = ZSpindleDetector(top_entry_sensor="B")

        self.assertFalse(detector._check_direction_change((False, True)))
        self.assertFalse(detector._check_direction_change((True, True)))
        self.assertFalse(detector._check_direction_change((False, True)))
        self.assertTrue(detector._check_direction_change((True, False)))

    def test_invalid_top_entry_sensor_falls_back_to_a(self) -> None:
        detector = ZSpindleDetector(top_entry_sensor="invalid")
        self.assertEqual(detector.top_entry_sensor, "A")


if __name__ == "__main__":
    unittest.main()
