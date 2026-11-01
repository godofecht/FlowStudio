"""Pure standard-library reproducibility and source-budget tests."""
import unittest
from variadic_oracle import MAX_CASES, SEED, inject_variadic_assertions, variadic_cases


class VariadicOracleTests(unittest.TestCase):
    def test_reproducible_exact_integer_cases(self):
        first = variadic_cases()
        self.assertEqual(first, variadic_cases())
        self.assertEqual(len(first), MAX_CASES)
        self.assertEqual(SEED, 20261101)
        self.assertEqual(sum(kind == "valid" for kind, *_ in first), 40)
        self.assertEqual(sum(kind == "parse" for kind, *_ in first), 4)
        self.assertEqual(sum(kind == "runtime" for kind, *_ in first), 3)
        self.assertEqual(sum(kind == "overflow" for kind, *_ in first), 1)
        for index in range(0, 32, 2):
            self.assertEqual(first[index][2], first[index + 1][2])
            self.assertNotEqual(first[index][1], first[index + 1][1])

    def test_sabotage_is_only_a_numerical_expectation(self):
        base = 'function main() -> i32 {\nprintln("native-math-variadic-ok")\nreturn 0\n}'
        good = inject_variadic_assertions(base)
        bad = inject_variadic_assertions(base, sabotage=True)
        self.assertIn('sum(', good)
        self.assertNotEqual(good, bad)
        self.assertEqual(good.count('evaluate_math_expression('), 44)
        self.assertEqual(bad.count('evaluate_math_expression('), 44)
        self.assertEqual(good.count('infer_math_expression_source('), 44)
        self.assertEqual(bad.count('infer_math_expression_source('), 44)
        self.assertEqual(good.count('near(result.result.value,'), 40)
        self.assertEqual(bad.count('near(result.result.value,'), 40)
        expected = variadic_cases()[0][2]
        self.assertEqual(
            good.replace(f"near(result.result.value, {expected}.0)",
                         f"near(result.result.value, {expected + 1}.0)", 1), bad)

    def test_marker_and_budget_fail_closed(self):
        with self.assertRaises(ValueError):
            inject_variadic_assertions('function main() -> i32 { return 0 }')
        with self.assertRaises(ValueError):
            inject_variadic_assertions('x' * (128 * 1024) + 'println("native-math-variadic-ok")')


if __name__ == "__main__":
    unittest.main()
