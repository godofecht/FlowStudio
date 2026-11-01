"""Source-level checks for the exact finite-difference cross-runtime acceptance."""
import contextlib
from fractions import Fraction
from io import StringIO
import unittest

from http_finite_difference_interop import (
    exact_stencil, python_source, r_source, sampled_stencils,
)


class FiniteDifferenceInteropSourceTests(unittest.TestCase):
    def test_all_27_exact_stencils_and_budget(self) -> None:
        records = sampled_stencils()
        self.assertEqual(len(records), 27)
        self.assertEqual([index for index, _, _ in records], list(range(27)))
        for index, values, expected in records:
            self.assertEqual(exact_stencil(index, values), expected)
            self.assertEqual(expected.denominator, 1)
            self.assertGreater(values[-1], 0)
        self.assertLess(len(r_source(records).encode("utf-8")), 128 * 1024)
        self.assertEqual(r_source(records).count("FLOWSTUDIO_FD_INTEROP_V1"), 27)

    def test_python_exact_oracle_and_corruption(self) -> None:
        records = sampled_stencils()
        observed = [float(expected) for _, _, expected in records]
        source = python_source(records, observed)
        with contextlib.redirect_stdout(StringIO()) as capture:
            exec(compile(source, "<fd-interoperability-oracle>", "exec"), {})
        self.assertIn("finite-difference-interoperability-oracle-ok", capture.getvalue())
        corrupted = python_source(records, observed, sabotage=True)
        self.assertNotEqual(source, corrupted)
        with self.assertRaisesRegex(AssertionError, "fd oracle mismatch"):
            exec(compile(corrupted, "<fd-corruption-oracle>", "exec"), {})

    def test_noninteger_spacing_exact_rational(self) -> None:
        self.assertEqual(exact_stencil(0, [1, 3, 4]), Fraction(1, 4))
        self.assertEqual(exact_stencil(9, [1, 2, 5, 4]), Fraction(1, 8))
        self.assertEqual(exact_stencil(18, [0, 1, 1, 2, 2, 2, 4]), Fraction(5, 4))


if __name__ == "__main__":
    unittest.main()
