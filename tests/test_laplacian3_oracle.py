"""Independent exact-rational 3D manufactured PDE stencils for native Flow HTTP."""
from __future__ import annotations

from fractions import Fraction
import unittest


def _decimal(value: Fraction) -> str:
    assert value.denominator & (value.denominator - 1) == 0
    return str(value.numerator) if value.denominator == 1 else str(float(value))


def manufactured_laplacian3_cases() -> list[tuple[str, Fraction, str, Fraction, Fraction]]:
    # f = ax*x² + ay*y² + az*z² + bx*x⁴ + by*y⁴ + bz*z⁴.
    # At the origin the exact Laplacian is 2(ax+ay+az), and the
    # seven-point truncation error is 2(bx*dx²+by*dy²+bz*dz²).
    coefficients = [
        (0, 0, 0, 1, 2, 3),
        (2, 3, 4, 1, 2, 3),
        (1, 0, 2, 3, 1, 5),
    ]
    coarse_steps = (Fraction(2), Fraction(1), Fraction(1, 2))
    fine_steps = tuple(step / 2 for step in coarse_steps)
    records = []
    for ax, ay, az, bx, by, bz in coefficients:
        exact = Fraction(2 * (ax + ay + az))

        def stencil(steps: tuple[Fraction, ...]) -> tuple[str, Fraction]:
            dx, dy, dz = steps
            x = ax * dx ** 2 + bx * dx ** 4
            y = ay * dy ** 2 + by * dy ** 4
            z = az * dz ** 2 + bz * dz ** 4
            expression = (
                f"laplacian3(0K,{_decimal(x)}K,{_decimal(x)}K,"
                f"{_decimal(y)}K,{_decimal(y)}K,"
                f"{_decimal(z)}K,{_decimal(z)}K,"
                f"{_decimal(dx)}m,{_decimal(dy)}m,{_decimal(dz)}m)"
            )
            observed = 2 * x / dx ** 2 + 2 * y / dy ** 2 + 2 * z / dz ** 2
            return expression, observed

        coarse_expr, coarse_value = stencil(coarse_steps)
        fine_expr, fine_value = stencil(fine_steps)
        assert coarse_value - exact == 4 * (fine_value - exact)
        assert coarse_value != exact
        records.append((coarse_expr, coarse_value, fine_expr, fine_value, exact))
    return records


def seeded_laplacian3_cases() -> list[tuple[str, Fraction]]:
    """24 deterministic spatial stencils: 12 independent fields and axis swaps."""
    state = 20261102

    def draw(low: int, high: int) -> int:
        nonlocal state
        state = (1664525 * state + 1013904223) & 0xFFFFFFFF
        return low + state % (high - low + 1)

    def make(samples: list[int], steps: list[int]) -> tuple[str, Fraction]:
        center = Fraction(samples[0])
        expected = sum(
            (Fraction(samples[1 + 2 * axis]) + Fraction(samples[2 + 2 * axis])
             - 2 * center) / (steps[axis] ** 2)
            for axis in range(3)
        )
        expression = "laplacian3(" + ",".join(
            [f"{value}K" for value in samples] +
            [f"{step}m" for step in steps]
        ) + ")"
        return expression, expected

    records = []
    for index in range(12):
        samples = [draw(-20, 20) for _ in range(7)]
        steps = [1 << draw(0, 3) for _ in range(3)]
        if index == 0:
            samples = [7] * 7
        if index == 1:
            samples = [0, 1, -1, 2, -2, 3, -3]
        first = make(samples, steps)
        swapped = make(
            [samples[0], samples[3], samples[4],
             samples[1], samples[2], samples[5], samples[6]],
            [steps[1], steps[0], steps[2]],
        )
        assert first[1] == swapped[1]
        records.extend((first, swapped))
    assert len(records) == 24
    return records


def inject_seeded_laplacian3_assertions(source: str, *, start: int = 0,
                                       stop: int = 8,
                                       sabotage: bool = False) -> str:
    cases = seeded_laplacian3_cases()
    assert 0 <= start < stop <= len(cases) and stop - start <= 8
    statements = []
    for index in range(start, stop):
        expression, expected = cases[index]
        value = float(expected + (1 if sabotage and index == start else 0))
        statements.extend((
            f'    result = evaluate_math_expression("{expression}")',
            f'    if not result.valid or not near(result.result.value,{value}) '
            f'{{ return {400 + index} }}',
        ))
    marker = 'println("native-math-finite-difference-ok")'
    assert source.count(marker) == 1
    return source.replace(marker, "\n".join(statements) + "\n" + marker)


def inject_laplacian3_assertions(source: str, *, sabotage: bool = False) -> str:
    statements = ["    let mut coarse_laplacian3: f64 = 0.0"]
    for index, (coarse, coarse_value, fine, fine_value, exact) in enumerate(
        manufactured_laplacian3_cases()
    ):
        expected = float(coarse_value + (1 if sabotage and index == 0 else 0))
        statements.extend([
            f'    result = evaluate_math_expression("{coarse}")',
            f'    if not result.valid or not near(result.result.value,{expected}) '
            f'{{ return {300 + index * 3} }}',
            '    coarse_laplacian3 = result.result.value',
            f'    result = evaluate_math_expression("{fine}")',
            f'    if not result.valid or not near(result.result.value,{float(fine_value)}) '
            f'{{ return {301 + index * 3} }}',
            f'    if not near(coarse_laplacian3-{float(exact)},'
            f'4.0*(result.result.value-{float(exact)})) '
            f'{{ return {302 + index * 3} }}',
        ])
    marker = 'println("native-math-finite-difference-ok")'
    assert source.count(marker) == 1
    return source.replace(marker, "\n".join(statements) + "\n" + marker)


class ExactLaplacian3Oracle(unittest.TestCase):
    def test_exact_manufactured_refinement(self) -> None:
        cases = manufactured_laplacian3_cases()
        self.assertEqual(len(cases), 3)
        self.assertEqual(len({c[0] for c in cases}), 3)
        for coarse, coarse_value, fine, fine_value, exact in cases:
            self.assertIn("laplacian3(", coarse)
            self.assertIn("laplacian3(", fine)
            self.assertEqual(coarse_value - exact, 4 * (fine_value - exact))

    def test_injected_native_source_and_sabotage(self) -> None:
        marker = 'println("native-math-finite-difference-ok")'
        normal = inject_laplacian3_assertions(marker)
        broken = inject_laplacian3_assertions(marker, sabotage=True)
        self.assertNotEqual(normal, broken)
        self.assertEqual(normal.count("evaluate_math_expression"), 6)
        self.assertEqual(normal.count("coarse_laplacian3 ="), 3)
        self.assertEqual(normal.count(marker), 1)


    def test_seeded_axis_permutations_and_corruption(self) -> None:
        cases = seeded_laplacian3_cases()
        self.assertEqual(len(cases), 24)
        self.assertEqual(len({expression for expression, _ in cases}), 24)
        for index in range(0, 24, 2):
            self.assertEqual(cases[index][1], cases[index + 1][1])
        marker = 'println("native-math-finite-difference-ok")'
        normal = inject_seeded_laplacian3_assertions(marker, start=0, stop=8)
        broken = inject_seeded_laplacian3_assertions(
            marker, start=0, stop=8, sabotage=True)
        self.assertEqual(normal.count("evaluate_math_expression"), 8)
        self.assertNotEqual(normal, broken)
        self.assertEqual(normal.count(marker), 1)
        with self.assertRaises(AssertionError):
            inject_seeded_laplacian3_assertions(marker, start=0, stop=9)


if __name__ == "__main__":
    unittest.main()
