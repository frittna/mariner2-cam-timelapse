import unittest
from mariner.server.z_spindle_detector import ZSpindleDetector


class ZSpindleDetectorTest(unittest.TestCase):

    def test_normal_downward_triggers_once(self) -> None:
        # Sequence: 00->01->11->10->00, normal mode -> only 00->01 triggers
        d = ZSpindleDetector()
        # d._last_state starts at (0,0)
        self.assertTrue(d._is_downward_start((False, True)))    # 00->01 -> TRIGGER
        d._last_state = (False, True)
        self.assertFalse(d._is_downward_start((True, True)))    # 01->11 no trigger
        d._last_state = (True, True)
        self.assertFalse(d._is_downward_start((True, False)))   # 11->10 no trigger
        d._last_state = (True, False)
        self.assertFalse(d._is_downward_start((False, False)))  # 10->00 no trigger

    def test_normal_upward_never_triggers(self) -> None:
        # Upward sequence: 00->10->11->01->00 -> none trigger in normal mode
        d = ZSpindleDetector()
        self.assertFalse(d._is_downward_start((True, False)))   # 00->10 no trigger
        d._last_state = (True, False)
        self.assertFalse(d._is_downward_start((True, True)))
        d._last_state = (True, True)
        self.assertFalse(d._is_downward_start((False, True)))
        d._last_state = (False, True)
        self.assertFalse(d._is_downward_start((False, False)))

    def test_inverted_downward_triggers_once(self) -> None:
        # Inverted mode: 00->10 triggers
        d = ZSpindleDetector(top_entry_sensor="B")
        self.assertTrue(d._is_downward_start((True, False)))    # 00->10 triggers

    def test_inverted_upward_never_triggers(self) -> None:
        # Inverted upward: 00->01 no trigger
        d = ZSpindleDetector(top_entry_sensor="B")
        self.assertFalse(d._is_downward_start((False, True)))   # 00->01 no trigger

    def test_invalid_sensor_falls_back_to_a(self) -> None:
        d = ZSpindleDetector(top_entry_sensor="X")
        self.assertEqual(d.top_entry_sensor, "A")


if __name__ == "__main__":
    unittest.main()
