"""Source-only independent oracle tests; production HTTP is a separate gate."""
from contextlib import redirect_stdout
from fractions import Fraction
from io import StringIO
import statistics
import unittest

from http_robust_interop import (
    MARKER, MAX_RESPONSE_BYTES, MAX_SOURCE_BYTES, VALID_COUNT,
    _case_values, _python_verifier, _r_program, _valid_cases,
)


class RobustInteropSourceTests(unittest.TestCase):
    def test_si_inputs_and_real_r_program_budget(self):
        cases = _valid_cases()
        self.assertEqual(len(cases), VALID_COUNT)
        source = _r_program(cases)
        self.assertEqual(source.count("cat('" + MARKER), VALID_COUNT)
        self.assertEqual(source.count("mad(x, constant=1)"), VALID_COUNT // 2)
        self.assertLess(len(source.encode("utf-8")), MAX_SOURCE_BYTES)
        self.assertIn("flowstudio_robust_r_count <- 48L", source)
        self.assertTrue(any("km" in expression for _, expression, _, _ in cases))
        self.assertTrue(any("s" in expression for _, expression, _, _ in cases))
        self.assertEqual(_case_values("median(2km,-1m,4m)"),
                         ("median", (2000, -1, 4)))
        for expression in ("mean(1,2)", "median(1m,2s)", "mad(1,)", "median()"):
            with self.assertRaises(ValueError):
                _case_values(expression)

    def test_python_exact_oracle_and_corruption(self):
        cases = _valid_cases()
        observed = []
        for _, expression, expected, _ in cases:
            operation, values = _case_values(expression)
            samples = [Fraction(v) for v in values]
            center = statistics.median(samples)
            result = center if operation == "median" else statistics.median(
                [abs(value - center) for value in samples])
            self.assertEqual(result, expected)
            observed.append(float(result))
        source = _python_verifier(cases, observed)
        self.assertLess(len(source.encode("utf-8")), MAX_SOURCE_BYTES)
        output = StringIO()
        namespace = {}
        with redirect_stdout(output):
            exec(compile(source, "<robust-r-python-oracle>", "exec"), namespace)
        self.assertIn("robust-r-python-oracle-ok", output.getvalue())
        self.assertNotIn("flowstudio_robust_check", namespace)
        with self.assertRaisesRegex(AssertionError, "robust-statistics mismatch"):
            exec(compile(_python_verifier(cases, observed, corrupt=True),
                         "<robust-corruption>", "exec"), {})
        with self.assertRaisesRegex(AssertionError, "robust frame invalid"):
            exec(compile(_python_verifier(cases, observed[:-1]),
                         "<robust-truncation>", "exec"), {})
        with self.assertRaises(ValueError):
            _python_verifier(cases, [float("nan")] + observed[1:])
        self.assertLess(len(str(observed).encode("utf-8")), MAX_RESPONSE_BYTES)


if __name__ == "__main__":
    unittest.main()
