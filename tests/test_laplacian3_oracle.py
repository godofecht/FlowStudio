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


if __name__ == "__main__":
    unittest.main()
