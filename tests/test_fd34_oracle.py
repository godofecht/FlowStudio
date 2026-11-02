"""Independent exact-rational manufactured polynomials for native fd3/fd4."""
from fractions import Fraction
import unittest

MARKER = 'println("native-math-fd34-ok")'
STEPS = (Fraction(1), Fraction(1, 2), Fraction(1, 4))
POLYNOMIALS = (("fd3", 3), ("fd3", 5), ("fd4", 4), ("fd4", 6))
CASE_COUNT = len(STEPS) * len(POLYNOMIALS)


def exact_derivative(name: str, samples: tuple[Fraction, ...],
                     h: Fraction) -> Fraction:
    if h <= 0:
        raise ValueError("spacing must be positive")
    if name == "fd3" and len(samples) == 4:
        fmm, fm, fp, fpp = samples
        return (fpp - fmm - 2 * (fp - fm)) / (2 * h ** 3)
    if name == "fd4" and len(samples) == 5:
        fmm, fm, f0, fp, fpp = samples
        return (fmm - 4 * fm + 6 * f0 - 4 * fp + fpp) / h ** 4
    raise ValueError("unknown derivative or sample count")


def manufactured_cases():
    cases = []
    for name, power in POLYNOMIALS:
        offsets = (-2, -1, 1, 2) if name == "fd3" else (-2, -1, 0, 1, 2)
        for h in STEPS:
            samples = tuple((Fraction(offset) * h) ** power for offset in offsets)
            exact = exact_derivative(name, samples, h)
            expression = name + "(" + ",".join(
                [str(float(sample)) + "K" for sample in samples]
                + [str(float(h)) + "m"]
            ) + ")"
            cases.append((expression, exact, name, power, h))
    return tuple(cases)


def inject_analytic_assertions(source: str, *, start: int = 0,
                               stop: int = 3, sabotage: bool = False) -> str:
    cases = manufactured_cases()
    assert 0 <= start < stop <= CASE_COUNT and stop - start <= 3
    assert source.count(MARKER) == 1
    statements = []
    for number in range(start, stop):
        expression, exact, _, _, _ = cases[number]
        expected = float(exact + (1 if sabotage and number == start else 0))
        statements.extend((
            f'    result = evaluate_math_expression("{expression}")',
            f'    if not result.valid or not near(result.result.value,{expected}) '
            f'{{ return {900 + number} }}',
        ))
    return source.replace(MARKER, "\n".join(statements) + "\n" + MARKER)


class HigherDerivativeOracleTests(unittest.TestCase):
    def test_exact_manufactured_polynomials(self):
        cases = manufactured_cases()
        self.assertEqual(len(cases), CASE_COUNT)
        for _, value, name, power, h in cases:
            expected = {
                3: Fraction(6), 4: Fraction(24),
                5: 30 * h * h, 6: 120 * h * h,
            }[power]
            self.assertEqual(value, expected, (name, power, h))

    def test_second_order_refinement_and_annihilation(self):
        for name, power in (("fd3", 5), ("fd4", 6)):
            errors = [value for _, value, n, p, _ in manufactured_cases()
                      if n == name and p == power]
            self.assertEqual(errors[0], 4 * errors[1])
            self.assertEqual(errors[1], 4 * errors[2])
        for name, degree, offsets in (
            ("fd3", 2, (-2, -1, 1, 2)),
            ("fd4", 3, (-2, -1, 0, 1, 2)),
        ):
            for h in STEPS:
                samples = tuple((Fraction(x) * h) ** degree for x in offsets)
                self.assertEqual(exact_derivative(name, samples, h), 0)

    def test_invalid_inputs_and_sabotage(self):
        with self.assertRaises(ValueError):
            exact_derivative("fd3", (Fraction(0),) * 4, Fraction(0))
        with self.assertRaises(ValueError):
            exact_derivative("fd4", (Fraction(0),) * 4, Fraction(1))
        self.assertNotEqual(
            inject_analytic_assertions(MARKER),
            inject_analytic_assertions(MARKER, sabotage=True))
        with self.assertRaises(AssertionError):
            inject_analytic_assertions(MARKER, stop=4)


if __name__ == "__main__":
    unittest.main()
