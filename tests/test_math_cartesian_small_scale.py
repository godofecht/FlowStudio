"""Regression tests for scale-independent Cartesian-grid validation."""
import pathlib
import sys
import unittest

import numpy as np

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "src"))
from math_flow_expr import ExpressionError, evaluate, parse_expression


class CartesianGeometryTests(unittest.TestCase):
    def test_microscopic_regular_grid(self):
        axis = np.arange(8, dtype=np.float64) * 1e-8
        x, y = np.meshgrid(axis, axis, indexing="ij")
        result = evaluate(parse_expression("∂ₓ(x)"), x, y)
        self.assertEqual(result.shape, (8, 8))
        self.assertTrue(np.all(np.isfinite(result)))

    def test_microscopic_sheared_grid_is_rejected(self):
        axis = np.arange(8, dtype=np.float64) * 1e-8
        x, y = np.meshgrid(axis, axis, indexing="ij")
        # Previously accepted because absolute tolerance 1e-12 dwarfed
        # the physically meaningful 1e-13 transverse displacement.
        x = x + np.arange(8, dtype=np.float64)[None, :] * 1e-13
        with self.assertRaisesRegex(ExpressionError, "uniformly spaced Cartesian"):
            evaluate(parse_expression("∂ₓ(x)"), x, y)

    def test_microscopic_nonuniform_spacing_is_rejected(self):
        axis = np.arange(8, dtype=np.float64) * 1e-8
        axis[4:] += 1e-13
        x, y = np.meshgrid(axis, np.arange(8) * 1e-8, indexing="ij")
        with self.assertRaisesRegex(ExpressionError, "uniformly spaced Cartesian"):
            evaluate(parse_expression("∂ₓ(x)"), x, y)


if __name__ == "__main__":
    unittest.main()
