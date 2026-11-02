"""Offline independent guards for the mandatory live 2D Flow/R/Python gate."""
import contextlib
import io
import math
import unittest

from http_native_heat2d_interop import (
    SOURCE, MARKER, END, INITIAL, MAX_SOURCE_BYTES, STEPS,
    derivative, fourier_solution, matrix_rk4, python_source, r_source,
    read_frame,
)


class NativeHeat2DInteropOracle(unittest.TestCase):
    def test_independent_fourier_and_matrix_rk4(self):
        computed = matrix_rk4()
        exact = fourier_solution()
        self.assertEqual(len(computed), 4)
        self.assertLess(max(abs(a-b) for a, b in zip(computed, exact)), 1e-9)
        self.assertLess(abs(sum(computed) - sum(INITIAL)), 1e-12)
        self.assertLess(sum(x*x for x in computed), sum(x*x for x in INITIAL))
        self.assertEqual(sum(derivative((2., 2., 2., 2.))), 0.0)
        self.assertEqual(STEPS, 64)

    def test_python_generated_oracle_and_negative_controls(self):
        observed = matrix_rk4()
        for kwargs, expected in (({}, "heat2d-python-matrix-rk4-ok"),
                                 ({"sabotage": True}, "heat2d matrix RK4 mismatch"),
                                 ({"truncate": True}, "heat2d frame invalid")):
            source = python_source(observed, **kwargs)
            self.assertLess(len(source.encode()), MAX_SOURCE_BYTES)
            compile(source, "<heat2d-persistent-python>", "exec")
            with contextlib.redirect_stdout(io.StringIO()) as out:
                if kwargs:
                    with self.assertRaisesRegex(AssertionError, expected):
                        exec(source, {})
                else:
                    exec(source, {})
                    self.assertIn(expected, out.getvalue())

    def test_native_frame_rejects_corruption(self):
        observed = matrix_rk4()
        body = "\n".join([MARKER, *(format(v, ".17g") for v in observed),
                          END, "native-evolution-heat2d-ok", ""])
        self.assertEqual(read_frame(body), tuple(float(format(v, ".17g"))
                                                  for v in observed))
        for invalid in (body.replace(END, ""), body.replace(MARKER, ""),
                        body.replace("native-evolution-heat2d-ok", "")):
            with self.assertRaises(AssertionError):
                read_frame(invalid)

    def test_checked_in_native_source_and_r_budget(self):
        source = SOURCE.read_text(encoding="utf-8")
        self.assertLess(len(source.encode()), MAX_SOURCE_BYTES)
        self.assertIn("flow AnisotropicHeat2D {", source)
        self.assertIn("AnisotropicHeat2D_step(&state, dt)", source)
        self.assertIn(MARKER, source)
        self.assertIn(END, source)
        self.assertIn("if error64 > 0.0000000001 { return 3 }", source)
        for sabotage in (False, True):
            self.assertLess(len(r_source(matrix_rk4(), sabotage=sabotage).encode()),
                            MAX_SOURCE_BYTES)


if __name__ == "__main__":
    unittest.main()
