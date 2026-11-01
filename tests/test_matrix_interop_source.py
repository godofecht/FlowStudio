"""Deterministic source/oracle checks; real HTTP acceptance is in http_smoke.py."""
from contextlib import redirect_stdout
from fractions import Fraction
from io import StringIO
import math
import unittest

from determinant_oracle import determinant_permutations, matrix_cases
from http_matrix_interop import (
    MARKER, MAX_FRAME_BYTES, MAX_SOURCE_BYTES, _python_verifier, _r_program,
)


class MatrixInteropSourceTests(unittest.TestCase):
    def test_seeded_r_source_is_bounded_and_complete(self):
        cases = matrix_cases()
        source = _r_program(cases)
        self.assertEqual(len(cases), 43)
        self.assertEqual(source.count("cat('" + MARKER), 43)
        self.assertLess(len(source.encode("utf-8")), MAX_SOURCE_BYTES)
        self.assertIn("qr(flowstudio_matrix_A, tol=1e-12)$rank", source)
        self.assertIn("solve(flowstudio_matrix_A, flowstudio_matrix_b)", source)

    def test_independent_exact_cramer_oracle_and_corruption(self):
        cases = matrix_cases()
        observed = []
        for _, rows, determinant in cases:
            n = len(rows)
            self.assertEqual(determinant_permutations(rows), determinant)
            if determinant:
                rhs = (1, -2, 3, -4)[:n]
                solution = [float(Fraction(determinant_permutations(tuple(
                    tuple(rhs[i] if k == j else rows[i][k] for k in range(n))
                    for i in range(n))), determinant)) for j in range(n)]
            else:
                solution = [0.0] * n
            observed.append([float(determinant), n if determinant else n - 1, solution])
        output = StringIO()
        with redirect_stdout(output):
            exec(compile(_python_verifier(cases, observed), "<matrix-oracle>", "exec"), {})
        self.assertIn("matrix-interoperability-oracle-ok", output.getvalue())
        with self.assertRaisesRegex(AssertionError, "matrix solve mismatch"):
            exec(compile(_python_verifier(cases, observed, corrupt=True),
                         "<matrix-corrupt>", "exec"), {})
        observed[0][2][0] = math.nan
        with self.assertRaises(ValueError):
            _python_verifier(cases, observed)


if __name__ == "__main__":
    unittest.main()
