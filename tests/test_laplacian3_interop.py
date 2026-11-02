"""Exact local qualification of the real 3D R/Python HTTP oracle sources."""
from __future__ import annotations

import contextlib
from fractions import Fraction
from io import StringIO
import unittest

from http_laplacian3_interop import (
    python_source, r_source, sampled_laplacian3, stencil,
)


class Laplacian3InteropTests(unittest.TestCase):
    def test_exact_3d_samples_and_resource_limits(self) -> None:
        records = sampled_laplacian3()
        self.assertEqual(len(records), 30)
        self.assertEqual([index for index, _, _ in records], list(range(30)))
        for _, values, expected in records:
            self.assertEqual(stencil(values), expected)
            self.assertEqual(len(values), 10)
            self.assertTrue(all(h > 0 for h in values[7:]))
        for index, exact in enumerate((Fraction(0), Fraction(18), Fraction(6))):
            self.assertEqual(records[2 * index][2] - exact,
                             4 * (records[2 * index + 1][2] - exact))
        for index in range(6, 30, 2):
            self.assertEqual(records[index][2], records[index + 1][2])
        source = r_source(records)
        self.assertLess(len(source.encode("utf-8")), 128 * 1024)
        self.assertEqual(source.count("FLOWSTUDIO_LAPLACIAN3_INTEROP_V1"), 30)

    def test_exact_python_oracle_corruption_and_truncation(self) -> None:
        records = sampled_laplacian3()
        observed = [float(expected) for _, _, expected in records]
        source = python_source(records, observed)
        with contextlib.redirect_stdout(StringIO()) as captured:
            exec(compile(source, "<laplacian3-oracle>", "exec"), {})
        self.assertIn("laplacian3-r-python-oracle-ok", captured.getvalue())
        self.assertLess(len(source.encode("utf-8")), 128 * 1024)
        with self.assertRaisesRegex(AssertionError, "laplacian3 oracle mismatch"):
            exec(compile(python_source(records, observed, sabotage=True),
                         "<laplacian3-sabotage>", "exec"), {})
        with self.assertRaisesRegex(AssertionError, "laplacian3 frame invalid"):
            exec(compile(python_source(records, observed, truncate=True),
                         "<laplacian3-truncated>", "exec"), {})

    def test_reject_invalid_spacings_and_arity(self) -> None:
        values = sampled_laplacian3()[0][1]
        with self.assertRaises(ValueError):
            stencil(values[:9])
        with self.assertRaises(ValueError):
            stencil(values[:9] + [Fraction(0)])
        with self.assertRaises(ValueError):
            stencil(values[:9] + [Fraction(-1)])


if __name__ == "__main__":
    unittest.main()
