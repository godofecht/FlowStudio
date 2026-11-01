"""Independent exact-rational polynomial oracles for native SI finite differences."""
from fractions import Fraction
from random import Random
import unittest


def finite_difference_cases() -> list[tuple[str, Fraction]]:
    rng = Random(20261101)
    cases: list[tuple[str, Fraction]] = []
    for _ in range(9):
        slope = rng.randint(-8, 8)
        offset = rng.randint(-20, 20)
        step = rng.randint(1, 5)
        left, right = offset - slope * step, offset + slope * step
        expected = Fraction(right - left, 2 * step)
        assert expected == slope
        cases.append((f"fd1({left}K,{right}K,{step}m)", expected))
    for _ in range(9):
        quadratic = rng.randint(-6, 6)
        linear = rng.randint(-8, 8)
        offset = rng.randint(-20, 20)
        step = rng.randint(1, 5)
        left = quadratic * step * step - linear * step + offset
        right = quadratic * step * step + linear * step + offset
        expected = Fraction(left - 2 * offset + right, step * step)
        assert expected == 2 * quadratic
        cases.append((f"fd2({left}K,{offset}K,{right}K,{step}m)", expected))
    for _ in range(9):
        ax = rng.randint(-5, 5)
        ay = rng.randint(-5, 5)
        bx = rng.randint(-5, 5)
        by = rng.randint(-5, 5)
        center = rng.randint(-10, 10)
        dx = rng.randint(1, 4)
        dy = rng.randint(1, 4)
        left = ax * dx * dx - bx * dx + center
        right = ax * dx * dx + bx * dx + center
        down = ay * dy * dy - by * dy + center
        up = ay * dy * dy + by * dy + center
        expected = (Fraction(left - 2 * center + right, dx * dx)
                    + Fraction(down - 2 * center + up, dy * dy))
        assert expected == 2 * (ax + ay)
        cases.append((
            f"laplacian2({center}K,{left}K,{right}K,{down}K,{up}K,{dx}m,{dy}m)",
            expected,
        ))
    return cases


def inject_finite_difference_assertions(source: str, *, start: int = 0,
                                        stop: int = 27, sabotage: bool = False) -> str:
    cases = finite_difference_cases()
    statements: list[str] = []
    for index in range(start, stop):
        expression, expected = cases[index]
        numeric = float(expected + (1 if sabotage and index == start else 0))
        statements.append(
            f'    result = evaluate_math_expression("{expression}")\n'
            f'    if not result.valid or not near(result.result.value,{numeric}) '
            f'{{ return {100 + index} }}'
        )
    # HTTP bundling removes leading indentation; match the semantic marker.
    marker = 'println("native-math-finite-difference-ok")'
    assert source.count(marker) == 1
    return source.replace(marker, "\n".join(statements) + "\n" + marker)



def manufactured_refinement_cases() -> list[tuple[str, Fraction, str, Fraction, Fraction]]:
    """Independent manufactured polynomials with exact second-order error ratios."""
    def decimal(value: Fraction) -> str:
        # Every generated fraction has a power-of-two denominator, hence an
        # exact finite binary and decimal representation.
        assert value.denominator & (value.denominator - 1) == 0
        return str(value.numerator) if value.denominator == 1 else str(float(value))

    def cubic(x: Fraction) -> Fraction:
        return x ** 3 + 2 * x

    def quartic(x: Fraction) -> Fraction:
        return 3 * x ** 2 + x ** 4

    def surface(x: Fraction, y: Fraction) -> Fraction:
        return 3 * x ** 2 + 2 * y ** 2 + x ** 4 + 2 * y ** 4

    def first(h: Fraction) -> tuple[str, Fraction]:
        left, right = cubic(-h), cubic(h)
        return (f"fd1({decimal(left)}K,{decimal(right)}K,{decimal(h)}m)",
                (right - left) / (2 * h))

    def second(h: Fraction) -> tuple[str, Fraction]:
        left, center, right = quartic(-h), quartic(Fraction(0)), quartic(h)
        return (f"fd2({decimal(left)}K,{decimal(center)}K,{decimal(right)}K,{decimal(h)}m)",
                (left - 2 * center + right) / h ** 2)

    def laplacian(hx: Fraction, hy: Fraction) -> tuple[str, Fraction]:
        center = surface(Fraction(0), Fraction(0))
        left, right = surface(-hx, Fraction(0)), surface(hx, Fraction(0))
        down, up = surface(Fraction(0), -hy), surface(Fraction(0), hy)
        expression = (
            f"laplacian2({decimal(center)}K,{decimal(left)}K,{decimal(right)}K,"
            f"{decimal(down)}K,{decimal(up)}K,{decimal(hx)}m,{decimal(hy)}m)"
        )
        return (expression,
                (left - 2 * center + right) / hx ** 2
                + (down - 2 * center + up) / hy ** 2)

    coarse_first, fine_first = first(Fraction(2)), first(Fraction(1))
    coarse_second, fine_second = second(Fraction(2)), second(Fraction(1))
    coarse_lap, fine_lap = (laplacian(Fraction(2), Fraction(3)),
                            laplacian(Fraction(1), Fraction(3, 2)))
    return [
        (*coarse_first, *fine_first, Fraction(2)),   # d/dx (x³+2x) at zero
        (*coarse_second, *fine_second, Fraction(6)), # d²/dx² (3x²+x⁴) at zero
        (*coarse_lap, *fine_lap, Fraction(10)),       # Δ(3x²+2y²+x⁴+2y⁴)
    ]


def inject_manufactured_refinement_assertions(source: str, *, sabotage: bool = False) -> str:
    """Execute both grid spacings and their exact 4:1 error ratio in native Flow."""
    statements = ["    let mut coarse_refinement: f64 = 0.0"]
    for index, (coarse, coarse_value, fine, fine_value, exact) in enumerate(
        manufactured_refinement_cases()
    ):
        expected = float(coarse_value + (1 if sabotage and index == 0 else 0))
        statements.extend([
            f'    result = evaluate_math_expression("{coarse}")',
            f'    if not result.valid or not near(result.result.value,{expected}) '
            f'{{ return {200 + 3 * index} }}',
            '    coarse_refinement = result.result.value',
            f'    result = evaluate_math_expression("{fine}")',
            f'    if not result.valid or not near(result.result.value,{float(fine_value)}) '
            f'{{ return {201 + 3 * index} }}',
            f'    if not near(coarse_refinement-{float(exact)},'
            f'4.0*(result.result.value-{float(exact)})) '
            f'{{ return {202 + 3 * index} }}',
        ])
    marker = 'println("native-math-finite-difference-ok")'
    assert source.count(marker) == 1
    return source.replace(marker, "\n".join(statements) + "\n" + marker)


class ExactFiniteDifferenceOracle(unittest.TestCase):
    def test_all_27_polynomial_cases(self) -> None:
        cases = finite_difference_cases()
        self.assertEqual(len(cases), 27)
        self.assertEqual(len({expression for expression, _ in cases}), 27)
        self.assertTrue(all(value.denominator == 1 for _, value in cases))

    def test_injection_changes_only_expected_value(self) -> None:
        base = '    println("native-math-finite-difference-ok")'
        correct = inject_finite_difference_assertions(base, start=0, stop=9)
        sabotaged = inject_finite_difference_assertions(base, start=0, stop=9, sabotage=True)
        self.assertNotEqual(correct, sabotaged)
        self.assertEqual(correct.count("evaluate_math_expression"), 9)
        self.assertEqual(sabotaged.count("evaluate_math_expression"), 9)
        self.assertIn("{ return 100 }", correct)
        self.assertNotIn(": return", correct)

    def test_injection_accepts_compacted_http_marker(self) -> None:
        # Production HTTP bundles strip indentation from native Flow lines.
        base = 'println("native-math-finite-difference-ok")'
        source = inject_finite_difference_assertions(base, start=18, stop=27)
        self.assertEqual(source.count("evaluate_math_expression"), 9)
        self.assertEqual(source.count("native-math-finite-difference-ok"), 1)


    def test_manufactured_second_order_refinement(self) -> None:
        cases = manufactured_refinement_cases()
        self.assertEqual(len(cases), 3)
        self.assertEqual([coarse for _, coarse, _, _, _ in cases],
                         [Fraction(6), Fraction(14), Fraction(54)])
        self.assertEqual([fine for _, _, _, fine, _ in cases],
                         [Fraction(3), Fraction(8), Fraction(21)])
        for coarse_expr, coarse, fine_expr, fine, exact in cases:
            self.assertNotEqual(fine, exact)
            self.assertEqual(coarse - exact, 4 * (fine - exact))
            self.assertNotEqual(coarse_expr, fine_expr)

    def test_refinement_injection_and_negative_control(self) -> None:
        base = 'println("native-math-finite-difference-ok")'
        correct = inject_manufactured_refinement_assertions(base)
        corrupted = inject_manufactured_refinement_assertions(base, sabotage=True)
        self.assertEqual(correct.count("evaluate_math_expression"), 6)
        self.assertEqual(correct.count("coarse_refinement ="), 3)
        self.assertEqual(correct.count("4.0*(result.result.value-"), 3)
        self.assertNotEqual(correct, corrupted)
        self.assertIn("native-math-finite-difference-ok", correct)



if __name__ == "__main__":
    unittest.main()
