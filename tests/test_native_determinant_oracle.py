"""Independent seeded matrix-oracle checks for native Flow determinant HTTP acceptance."""
from __future__ import annotations

from pathlib import Path
import unittest

from determinant_oracle import (
    MAX_CASES, SEED, determinant_bareiss, determinant_permutations,
    inject_native_assertions, matrix_cases,
)


ROOT = Path(__file__).resolve().parents[1]
MODULES = (
    "src/math_dimensions.flow",
    "src/math_expression_ir.flow",
    "src/math_expression_source.flow",
    "src/math_equation.flow",
    "src/math_static.flow",
    "src/math_determinant_smoke.flow",
)


class NativeDeterminantOracle(unittest.TestCase):
    def test_exact_seeded_cases_and_metamorphic_relations(self):
        cases = matrix_cases()
        self.assertEqual(SEED, 20261101)
        self.assertEqual(len(cases), MAX_CASES)
        self.assertEqual(sum(function == "det2" for function, _, _ in cases), 17)
        self.assertEqual(sum(function == "det3" for function, _, _ in cases), 17)
        for function, rows, expected in cases:
            with self.subTest(function=function, rows=rows):
                self.assertEqual(determinant_bareiss(rows), expected)
                self.assertEqual(determinant_permutations(rows), expected)
                self.assertLessEqual(max(abs(x) for row in rows for x in row), 12)
        self.assertEqual(sum(expected == 0 for _, _, expected in cases), 2)

    def test_fraction_free_oracle_pivot_and_rejection_edges(self):
        self.assertEqual(determinant_bareiss(((0, 2), (3, 4))), -6)
        self.assertEqual(determinant_bareiss(((0, 1, 2),
                                               (1, 0, 3),
                                               (4, 5, 6))), 16)
        self.assertEqual(determinant_bareiss(((1, 2), (1, 2))), 0)
        for bad in (
            (), ((1,),), ((1, 2), (3,)), ((1, 2), (3, 13)),
            ((1, 2), (3, True)), ((1, 2, 3), (4, 5, 6)),
        ):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                determinant_bareiss(bad)

    def test_native_http_source_budget_and_deliberate_failure(self):
        source = "\n".join(
            "\n".join(
                line.removeprefix("export ").removeprefix("    ")
                for line in (ROOT / path).read_text(encoding="utf-8").splitlines()
                if line.strip() and not line.lstrip().startswith("#")
                if not line.startswith("import .math_dimensions {")
                and not line.startswith("import .math_expression_ir {")
                and not line.startswith("import .math_expression_source {")
                and not line.startswith("import .math_equation {")
                and not line.startswith("import .math_static {")
            )
            for path in MODULES
        )
        positive = inject_native_assertions(source)
        negative = inject_native_assertions(source, sabotage=True)
        self.assertLessEqual(len(positive.encode("utf-8")), 128 * 1024)
        self.assertEqual(positive.count('result = evaluate_math_expression("det'),
                         source.count('result = evaluate_math_expression("det') + 34)
        self.assertEqual(positive.count("return 70"), 34)
        self.assertNotEqual(positive, negative)
        self.assertIn('println("native-math-determinants-ok")', positive)
        self.assertIn('println("native-math-determinants-ok")', negative)


if __name__ == "__main__":
    unittest.main()
