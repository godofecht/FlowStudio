"""Executable mathematical Flow assignment target validation."""
import sys
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from math_flow import FlowMathError, assignments, lex


class AssignmentTargetTests(unittest.TestCase):
    def test_greek_and_ascii_targets(self):
        self.assertEqual(
            assignments(lex("α = 1\nΔ = 2\nvelocity = 3")),
            {"α": ["1"], "Δ": ["2"], "velocity": ["3"]},
        )

    def test_operator_and_number_targets_are_rejected(self):
        for source in ("∆ = 1", "∇ = 1", "2 = 3", "π = 1"):
            with self.subTest(source=source):
                with self.assertRaises(FlowMathError):
                    assignments(lex(source))

    def test_duplicate_greek_assignment_rejected(self):
        with self.assertRaisesRegex(FlowMathError, "Duplicate assignment"):
            assignments(lex("α = 1\nα = 2"))


if __name__ == "__main__":
    unittest.main()
