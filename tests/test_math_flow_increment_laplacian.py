"""Executable Unicode increment Laplacian alias acceptance."""
import unittest
import sys
from pathlib import Path
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from math_flow_expr import parse_expression, evaluate
from math_flow import lex


class IncrementLaplacianTests(unittest.TestCase):
    def test_tokenized_as_operator(self):
        self.assertEqual([token.text for token in lex("∆(x² + y²)")],
                         ["∆", "(", "x", "²", "+", "y", "²", ")"])

    def test_ast_and_dimension_match(self):
        symbols = {"temperature": (0, 0, 0, 1)}
        a = parse_expression("∆(temperature)", symbols=symbols)
        b = parse_expression("∇²(temperature)", symbols=symbols)
        self.assertEqual(a, b)
        self.assertEqual(a.dimension, (-2, 0, 0, 1))

    def test_periodic_manufactured_field(self):
        n = 32
        axis = np.arange(n, dtype=float) / n
        x, y = np.meshgrid(axis, axis, indexing="ij")
        field = np.sin(2 * np.pi * x) + np.cos(4 * np.pi * y)
        symbols = {"f": (0, 0, 0, 0)}
        a = evaluate(parse_expression("∆f", symbols=symbols), x, y, values={"f": field})
        b = evaluate(parse_expression("∇²(f)", symbols=symbols), x, y, values={"f": field})
        np.testing.assert_allclose(a, b, rtol=0, atol=1e-12)
        expected = -(4 * np.pi**2) * np.sin(2 * np.pi * x) - (16 * np.pi**2) * np.cos(4 * np.pi * y)
        self.assertLess(float(np.max(np.abs(a - expected))), 5.0)


if __name__ == "__main__":
    unittest.main()
