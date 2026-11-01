"""Independent deterministic rational Type-7 quantile and HTTP source tests."""
from fractions import Fraction
from pathlib import Path
import random
import statistics
import unittest

from quantile_oracle import (
    MAX_CASES, MAX_SOURCE_BYTES, VALID_COUNT, inject_quantile_assertions,
    quantile_cases, type7,
)
from http_quantile_interop import _r_program, _python_verifier

ROOT = Path(__file__).resolve().parents[1]


class QuantileOracleTests(unittest.TestCase):
    def test_exact_type7_against_independent_linear_interpolation(self):
        rng = random.Random(20261104)
        for _ in range(300):
            values = tuple(Fraction(x) for x in rng.sample(range(-100, 101), rng.randint(2, 7)))
            p = Fraction(rng.randint(0, 16), 16)
            actual = type7(p, values)
            sorted_values = sorted(values)
            scaled = p * (len(values) - 1)
            j = scaled.numerator // scaled.denominator
            expected = sorted_values[j] + (scaled - j) * (
                sorted_values[min(j + 1, len(values) - 1)] - sorted_values[j])
            self.assertEqual(actual, expected)
            self.assertEqual(type7(Fraction(1, 2), values),
                             Fraction(statistics.median(values)))
            self.assertEqual(type7(p, tuple(reversed(values))), actual)
        for p, values in ((Fraction(-1, 8), (Fraction(1), Fraction(2))),
                          (Fraction(9, 8), (Fraction(1), Fraction(2))),
                          (Fraction(1, 2), ())):
            with self.assertRaises(ValueError):
                type7(p, values)

    def test_seeded_cases_and_si_metamorphic_pairs(self):
        cases = quantile_cases()
        self.assertEqual(len(cases), MAX_CASES)
        self.assertEqual(sum(row[0] == "valid" for row in cases), VALID_COUNT)
        self.assertEqual(sum(row[0] == "parse" for row in cases), 4)
        self.assertEqual(sum(row[0] == "runtime" for row in cases), 8)
        for index in range(0, VALID_COUNT, 2):
            a, b = cases[index:index + 2]
            self.assertEqual(a[0], "valid")
            self.assertEqual(a[2:5], b[2:5])
            self.assertEqual(a[5], tuple(reversed(b[5])))
            self.assertNotEqual(a[1], b[1])
            self.assertEqual(a[2], type7(a[4], tuple(Fraction(x) for x in a[5])))
        self.assertTrue(any("km" in row[1] for row in cases))
        self.assertTrue(any("s" in row[1] for row in cases))

    def test_native_source_and_r_python_budget(self):
        from http_robust_statistics_smoke import bundled_source
        base = bundled_source(ROOT)
        for start in (0, 20, 40):
            source = inject_quantile_assertions(base, start=start, stop=start + 20)
            self.assertLess(len(source.encode()), MAX_SOURCE_BYTES)
            self.assertIn("quantile(", source)
        self.assertNotEqual(inject_quantile_assertions(base, start=0, stop=20),
                            inject_quantile_assertions(base, start=0, stop=20, sabotage=True))
        self.assertIn("return 93", inject_quantile_assertions(base, start=40, stop=60))
        cases = quantile_cases()[:VALID_COUNT]
        self.assertLess(len(_r_program(cases).encode()), MAX_SOURCE_BYTES)
        self.assertLess(len(_python_verifier(cases, [0.0] * VALID_COUNT).encode()), MAX_SOURCE_BYTES)
        for start, stop in ((-1, 20), (20, 20), (0, 61)):
            with self.assertRaises(ValueError):
                inject_quantile_assertions(base, start=start, stop=stop)
        with self.assertRaises(ValueError):
            inject_quantile_assertions(base + "x" * MAX_SOURCE_BYTES, start=0, stop=20)


if __name__ == "__main__":
    unittest.main()
