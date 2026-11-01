"""Deterministic source/oracle checks; real compiler acceptance is HTTP CI."""
import unittest

from unicode_variadic_oracle import (
    MAX_CASES, MAX_SOURCE_BYTES, SEED,
    inject_unicode_variadic_assertions, unicode_variadic_cases,
)


class UnicodeVariadicOracleTests(unittest.TestCase):
    def test_seeded_exact_cases_and_permutations(self):
        cases = unicode_variadic_cases()
        self.assertEqual(cases, unicode_variadic_cases())
        self.assertEqual(SEED, 20261102)
        self.assertEqual(len(cases), MAX_CASES)
        self.assertEqual(sum(kind == "valid" for kind, *_ in cases), 40)
        self.assertEqual(sum(kind == "parse" for kind, *_ in cases), 4)
        self.assertEqual(sum(kind == "runtime" for kind, *_ in cases), 3)
        self.assertEqual(sum(kind == "overflow" for kind, *_ in cases), 1)
        for index in range(0, 32, 2):
            self.assertEqual(cases[index][2], cases[index + 1][2])
            self.assertNotEqual(cases[index][1], cases[index + 1][1])
        self.assertTrue(all("∑(" in expression or "∏(" in expression
                            for _, expression, _, _ in cases))

    def test_sabotage_changes_only_one_numerical_assertion(self):
        base = 'function main() -> i32 {\nprintln("native-math-variadic-ok")\nreturn 0\n}'
        good = inject_unicode_variadic_assertions(base)
        bad = inject_unicode_variadic_assertions(base, sabotage=True)
        expected = unicode_variadic_cases()[0][2]
        self.assertEqual(
            good.replace(f"near(result.result.value, {expected}.0)",
                         f"near(result.result.value, {expected + 1}.0)", 1), bad)
        self.assertEqual(good.count('result = evaluate_math_expression("'), 40)
        self.assertEqual(good.count('inferred = infer_math_expression_source("'), 40)
        self.assertIn('source_start != 9', good)
        self.assertIn('source_end != 12', good)
        self.assertLess(len(good.encode("utf-8")), MAX_SOURCE_BYTES)

    def test_marker_and_source_ceiling(self):
        with self.assertRaises(ValueError):
            inject_unicode_variadic_assertions('function main() -> i32 { return 0 }')
        with self.assertRaises(ValueError):
            inject_unicode_variadic_assertions('println("native-math-variadic-ok")' * 2)
        with self.assertRaises(ValueError):
            inject_unicode_variadic_assertions(
                'x' * MAX_SOURCE_BYTES + 'println("native-math-variadic-ok")')


if __name__ == "__main__":
    unittest.main()
