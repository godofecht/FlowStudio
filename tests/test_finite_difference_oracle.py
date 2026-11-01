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
            f'    if not result.valid or not near(result.result.value,{numeric}): '
            f'return {100 + index}'
        )
    # HTTP bundling removes leading indentation; match the semantic marker.
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


if __name__ == "__main__":
    unittest.main()
