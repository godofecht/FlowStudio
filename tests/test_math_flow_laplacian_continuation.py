"""Regression tests for line-wrapped executable Laplacian expressions."""
import sys
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from math_flow import lex, lines


class LaplacianContinuationTests(unittest.TestCase):
    def test_prefix_operator_continues_on_next_line(self):
        self.assertEqual(lines(lex("result = ∆\nfield")),
                         [["result", "=", "∆", "field"]])

    def test_next_assignment_remains_distinct(self):
        self.assertEqual(
            lines(lex("result = ∆\nfield\nnext = 2")),
            [["result", "=", "∆", "field"], ["next", "=", "2"]],
        )


if __name__ == "__main__":
    unittest.main()
