"""Independent seeded SI dispersion oracle; native Flow/HTTP is a separate gate."""
from __future__ import annotations

from pathlib import Path
import re
import statistics
import unittest

from dispersion_oracle import (
    MAX_SOURCE_BYTES, NEGATIVE_CASES, VALID_CASES,
    dispersion_cases, inject_dispersion_assertions,
)

ROOT = Path(__file__).resolve().parents[1]


class DispersionOracleTests(unittest.TestCase):
    def test_seeded_cases_and_permutation_invariance(self) -> None:
        cases = dispersion_cases()
        self.assertEqual(len(cases), VALID_CASES + NEGATIVE_CASES)
        self.assertEqual(sum(kind == "valid" for kind, *_ in cases), VALID_CASES)
        for index in range(0, VALID_CASES, 2):
            first, second = cases[index:index + 2]
            self.assertEqual(first[0], "valid")
            self.assertEqual(first[2:], second[2:])
            self.assertNotEqual(first[1], second[1])
        self.assertTrue(any("km" in expression for _, expression, _, _ in cases))
        self.assertTrue(any("100" in expression for _, expression, _, _ in cases))

    def test_exact_rational_oracle_agrees_with_independent_statistics(self) -> None:
        for kind, expression, expected, dimension in dispersion_cases()[:VALID_CASES]:
            self.assertEqual(kind, "valid")
            match = re.fullmatch(r"(stddev|sample_variance|sample_stddev)\((.*)\)", expression)
            self.assertIsNotNone(match)
            operation, arguments = match.groups()
            values = []
            for token in arguments.split(","):
                part = re.fullmatch(r"(-?\d+)(km|m|s)?", token)
                self.assertIsNotNone(part)
                values.append(int(part[1]) * (1000 if part[2] == "km" else 1))
            standard = {
                "stddev": statistics.pstdev,
                "sample_variance": statistics.variance,
                "sample_stddev": statistics.stdev,
            }[operation](values)
            self.assertAlmostEqual(expected / standard if standard else expected, 1.0,
                                   delta=1e-12)
            self.assertEqual(len(dimension), 4)

    def test_negative_contract_and_source_limits(self) -> None:
        cases = dispersion_cases()
        self.assertEqual(sum(kind == "parse" for kind, *_ in cases), 7)
        self.assertEqual(sum(kind == "runtime" for kind, *_ in cases), 5)
        fixture = (ROOT / "src/math_dispersion_http_smoke.flow").read_text()
        self.assertEqual(fixture.count('println("native-math-dispersion-http-ok")'), 1)
        for start, stop in ((0, 16), (16, 32), (32, 48), (48, 60)):
            source = inject_dispersion_assertions(fixture, start=start, stop=stop)
            self.assertLess(len(source.encode("utf-8")), MAX_SOURCE_BYTES)
            self.assertIn("return 90" if start < 48 else "return 91", source)
        clean = inject_dispersion_assertions(fixture, start=0, stop=16)
        corrupted = inject_dispersion_assertions(fixture, start=0, stop=16, sabotage=True)
        self.assertNotEqual(clean, corrupted)
        for start, stop in ((-1, 2), (2, 2), (0, 61)):
            with self.assertRaises(ValueError):
                inject_dispersion_assertions(fixture, start=start, stop=stop)
        with self.assertRaises(ValueError):
            inject_dispersion_assertions(fixture + "x" * MAX_SOURCE_BYTES,
                                         start=0, stop=16)


if __name__ == "__main__":
    unittest.main()
