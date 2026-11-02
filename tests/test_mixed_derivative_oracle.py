"""Independent exact-rational oracle for native anisotropic mixed partials."""
from fractions import Fraction
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
SMOKE = ROOT / "src/math_mixed_derivative_smoke.flow"


class MixedDerivativeOracle(unittest.TestCase):
    def test_manufactured_cubic_convergence_executes_in_checked_in_flow(self):
        source = SMOKE.read_text(encoding="utf-8")
        x, y = Fraction(1), Fraction(2)
        exact = Fraction(36)  # d²(x³y³)/dxdy at (1,2)
        expected = (
            Fraction(2509, 64),
            Fraction(37681, 1024),
            Fraction(593089, 16384),
        )
        errors = []
        for (dx, dy), wanted in zip((
            (Fraction(1, 2), Fraction(1, 4)),
            (Fraction(1, 4), Fraction(1, 8)),
            (Fraction(1, 8), Fraction(1, 16)),
        ), expected):
            samples = tuple(
                (x + sx * dx) ** 3 * (y + sy * dy) ** 3
                for sx, sy in ((-1, -1), (1, -1), (-1, 1), (1, 1))
            )
            stencil = (samples[3] - samples[2] - samples[1] + samples[0]) / (4 * dx * dy)
            self.assertEqual(stencil, wanted)
            call = "fdxy(" + ",".join(
                [*(f"{float(v)}K" for v in samples),
                 f"{float(dx)}m", f"{float(dy)}m"]
            ) + ")"
            self.assertIn(call, source, "real native smoke must execute the exact oracle")
            self.assertIn(str(float(wanted)), source)
            errors.append(stencil - exact)
        self.assertTrue(all(e > 0 for e in errors))
        self.assertTrue(all(Fraction(39, 10) < a / b < Fraction(41, 10)
                            for a, b in zip(errors, errors[1:])))

    def test_mixed_derivative_is_orientation_sensitive_and_si_aware(self):
        source = SMOKE.read_text(encoding="utf-8")
        self.assertIn('fdxy(6K,-6K,-6K,6K,2m,3m)', source)
        self.assertIn('fdxy(-6K,6K,6K,-6K,2m,3m)', source)
        self.assertIn('infer_math_equation_source("fdxy(', source)
        self.assertIn('native-math-mixed-derivative-ok', source)


if __name__ == "__main__":
    unittest.main()
