import unittest

from mariner.server.z_spindle_detector import ZSpindleDetector


class ZSpindleDetectorTest(unittest.TestCase):
    def test_default_mode_triggers_for_a_first_sequence(self) -> None:
        # Mode A: 00 -> 10 -> 11 -> 01 -> 00 (A enters first)
        detector = ZSpindleDetector()

        self.assertFalse(detector._advance_sequence((False, False)))
        self.assertFalse(detector._advance_sequence((True, False)))
        self.assertFalse(detector._advance_sequence((True, True)))
        self.assertFalse(detector._advance_sequence((False, True)))
        self.assertTrue(detector._advance_sequence((False, False)))

    def test_default_mode_ignores_b_first_sequence(self) -> None:
        # Mode A: 00 -> 01 -> 11 -> 10 -> 00 does NOT trigger (B first)
        detector = ZSpindleDetector()

        self.assertFalse(detector._advance_sequence((False, False)))
        self.assertFalse(detector._advance_sequence((False, True)))
        self.assertFalse(detector._advance_sequence((True, True)))
        self.assertFalse(detector._advance_sequence((True, False)))
        self.assertFalse(detector._advance_sequence((False, False)))

    def test_inverted_mode_triggers_for_b_first_sequence(self) -> None:
        # Mode B: 00 -> 01 -> 11 -> 10 -> 00 (B enters first)
        detector = ZSpindleDetector(top_entry_sensor="B")

        self.assertFalse(detector._advance_sequence((False, False)))
        self.assertFalse(detector._advance_sequence((False, True)))
        self.assertFalse(detector._advance_sequence((True, True)))
        self.assertFalse(detector._advance_sequence((True, False)))
        self.assertTrue(detector._advance_sequence((False, False)))

    def test_inverted_mode_ignores_a_first_sequence(self) -> None:
        # Mode B: 00 -> 10 -> 11 -> 01 -> 00 does NOT trigger (A first)
        detector = ZSpindleDetector(top_entry_sensor="B")

        self.assertFalse(detector._advance_sequence((False, False)))
        self.assertFalse(detector._advance_sequence((True, False)))
        self.assertFalse(detector._advance_sequence((True, True)))
        self.assertFalse(detector._advance_sequence((False, True)))
        self.assertFalse(detector._advance_sequence((False, False)))

    def test_sequence_restarts_on_anchor_state(self) -> None:
        # Interrupted sequence restarts at 00
        detector = ZSpindleDetector()

        self.assertFalse(detector._advance_sequence((False, False)))
        self.assertFalse(detector._advance_sequence((True, False)))
        self.assertFalse(detector._advance_sequence((False, False)))
        self.assertFalse(detector._advance_sequence((True, False)))
        self.assertFalse(detector._advance_sequence((True, True)))
        self.assertFalse(detector._advance_sequence((False, True)))
        self.assertTrue(detector._advance_sequence((False, False)))

    def test_invalid_top_entry_sensor_falls_back_to_a(self) -> None:
        detector = ZSpindleDetector(top_entry_sensor="invalid")
        self.assertEqual(detector.top_entry_sensor, "A")


if __name__ == "__main__":
    unittest.main()
