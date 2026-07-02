import unittest

from mariner.server.z_spindle_detector import ZSpindleDetector


class ZSpindleDetectorTest(unittest.TestCase):
    def test_default_mode_triggers_on_complete_forward_cycle(self) -> None:
        # Full cycle A: 00->10->11->01->00 — trigger fires when mark fully exits
        detector = ZSpindleDetector()

        self.assertFalse(detector._advance_sequence((False, False)))
        self.assertFalse(detector._advance_sequence((True, False)))
        self.assertFalse(detector._advance_sequence((True, True)))
        self.assertFalse(detector._advance_sequence((False, True)))
        self.assertTrue(detector._advance_sequence((False, False)))

    def test_default_mode_does_not_trigger_for_reverse_cycle(self) -> None:
        # Reverse: 00->01->11->10->00 must NOT trigger in A mode
        detector = ZSpindleDetector()

        self.assertFalse(detector._advance_sequence((False, False)))
        self.assertFalse(detector._advance_sequence((False, True)))
        self.assertFalse(detector._advance_sequence((True, True)))
        self.assertFalse(detector._advance_sequence((True, False)))
        self.assertFalse(detector._advance_sequence((False, False)))

    def test_default_mode_requires_overlap_state(self) -> None:
        # Skipping 11 resets the sequence — no trigger
        detector = ZSpindleDetector()

        self.assertFalse(detector._advance_sequence((False, False)))
        self.assertFalse(detector._advance_sequence((True, False)))
        self.assertFalse(detector._advance_sequence((False, True)))   # wrong state -> reset
        self.assertFalse(detector._advance_sequence((False, False)))

    def test_sensor_b_mode_triggers_on_complete_reverse_cycle(self) -> None:
        # Full cycle B: 00->01->11->10->00 — trigger fires in B mode
        detector = ZSpindleDetector(top_entry_sensor="B")

        self.assertFalse(detector._advance_sequence((False, False)))
        self.assertFalse(detector._advance_sequence((False, True)))
        self.assertFalse(detector._advance_sequence((True, True)))
        self.assertFalse(detector._advance_sequence((True, False)))
        self.assertTrue(detector._advance_sequence((False, False)))

    def test_anchor_state_restarts_sequence_cleanly(self) -> None:
        # Interrupted sequence restarts at 00 and still completes correctly
        detector = ZSpindleDetector()

        self.assertFalse(detector._advance_sequence((False, False)))
        self.assertFalse(detector._advance_sequence((True, False)))
        self.assertFalse(detector._advance_sequence((False, False)))  # reset mid-sequence
        self.assertFalse(detector._advance_sequence((True, False)))
        self.assertFalse(detector._advance_sequence((True, True)))
        self.assertFalse(detector._advance_sequence((False, True)))
        self.assertTrue(detector._advance_sequence((False, False)))

    def test_invalid_top_entry_sensor_falls_back_to_a(self) -> None:
        detector = ZSpindleDetector(top_entry_sensor="invalid")

        self.assertEqual(detector.top_entry_sensor, "A")
        self.assertEqual(detector._top_entry_state(), (True, False))
        self.assertEqual(detector._top_target_state(), (False, True))


if __name__ == "__main__":
    unittest.main()
