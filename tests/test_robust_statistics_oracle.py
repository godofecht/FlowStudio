"""Independent source/oracle tests; native HTTP is a separate required gate."""
from fractions import Fraction
from pathlib import Path
import statistics
import unittest

from robust_statistics_oracle import (
    MAX_CASES, MAX_SOURCE_BYTES, inject_robust_assertions, robust_cases,
)
from http_robust_statistics_smoke import bundled_source

ROOT = Path(__file__).resolve().parents[1]


class RobustStatisticsOracleTests(unittest.TestCase):
    def test_exact_rational_expectations_and_metamorphic_pairs(self) -> None:
        cases = robust_cases()
        self.assertEqual(len(cases), MAX_CASES)
        self.assertEqual(sum(kind == "valid" for kind, *_ in cases), 48)
        self.assertEqual(sum(kind == "parse" for kind, *_ in cases), 6)
        self.assertEqual(sum(kind == "runtime" for kind, *_ in cases), 6)
        for first in range(0, 48, 2):
            a, b = cases[first:first + 2]
            self.assertEqual(a[0], "valid")
            self.assertEqual(a[2:], b[2:])
            self.assertNotEqual(a[1], b[1])
            self.assertIn(a[2].denominator, (1, 2))
            self.assertLess(abs(float(a[2])), 10_000)
        self.assertTrue(any("km" in expr for _, expr, _, _ in cases))
        self.assertTrue(any("100" in expr for _, expr, _, _ in cases))

    def test_fraction_median_independent_standard_library_check(self) -> None:
        from robust_statistics_oracle import _median
        samples = (
            (Fraction(-1000), Fraction(500), Fraction(0), Fraction(3)),
            (Fraction(1), Fraction(2), Fraction(3)),
            (Fraction(-5), Fraction(-2), Fraction(7), Fraction(8), Fraction(100)),
        )
        for values in samples:
            center = _median(values)
            self.assertEqual(center, Fraction(statistics.median(values)))
            self.assertEqual(
                _median(tuple(abs(value - center) for value in values)),
                Fraction(statistics.median([abs(value - center) for value in values])),
            )

    def test_injection_and_limits(self) -> None:
        fixture = (ROOT / "src/math_robust_statistics_smoke.flow").read_text()
        self.assertIn('println("native-math-robust-statistics-ok")', fixture)
        self.assertIn("let mut parsed: ParsedMathExpression", fixture)
        base = bundled_source(ROOT)
        for start in (0, 20, 40):
            expanded = inject_robust_assertions(base, start=start, stop=start + 20)
            self.assertIn("return 90", expanded)
            self.assertLess(len(expanded.encode("utf-8")), MAX_SOURCE_BYTES)
        clean = inject_robust_assertions(base, start=0, stop=20)
        corrupt = inject_robust_assertions(base, start=0, stop=20, sabotage=True)
        self.assertNotEqual(clean, corrupt)
        self.assertIn("return 93", inject_robust_assertions(base, start=40, stop=60))
        for start, stop in ((-1, 20), (20, 20), (0, 61)):
            with self.assertRaises(ValueError):
                inject_robust_assertions(fixture, start=start, stop=stop)
        with self.assertRaises(ValueError):
            inject_robust_assertions(fixture + "x" * MAX_SOURCE_BYTES, start=0, stop=20)


if __name__ == "__main__":
    unittest.main()
