"""Exact-rational dimensional reduction of production diffusion2/diffusion3.

Seed 20261102 is inherited from the independently generated periodic 2D
shared-face grid. No production Flow implementation is used by the oracle.
"""
from fractions import Fraction
import unittest

from test_diffusion2_oracle import CELL_COUNT, MARKER, diffusion2, periodic_cases
from test_diffusion3_oracle import diffusion3, expression as diffusion3_expression


def lifted_cases():
    """Each 2D stencil has two different zero-flux 3D embeddings."""
    cases = []
    for expression2, expected, v in periodic_cases():
        c, left, right, down, up, kl, kr, kd, ku, dx, dy = v
        # A constant field along z has no z flux even with heterogeneous k.
        constant_z = (c, left, right, down, up, c, c,
                      kl, kr, kd, ku, Fraction(5, 4), Fraction(7, 4),
                      dx, dy, Fraction(4))
        # An insulating z direction has no flux even with large gradients.
        insulated_z = (c, left, right, down, up, c + 3, c - 5,
                       kl, kr, kd, ku, Fraction(0), Fraction(0),
                       dx, dy, Fraction(1, 2))
        assert expected == diffusion2(v)
        assert diffusion3(constant_z) == expected
        assert diffusion3(insulated_z) == expected
        cases.append((expression2, expected, constant_z, insulated_z))
    assert len(cases) == CELL_COUNT == 9
    return cases


def inject_reduction_assertions(source: str, *, index: int = 0,
                                sabotage: bool = False) -> str:
    """One cell per bounded real Flow HTTP request (three evaluations)."""
    assert 0 <= index < CELL_COUNT
    assert source.count(MARKER) == 1
    expr2, expected, constant_z, insulated_z = lifted_cases()[index]
    expressions = (expr2, diffusion3_expression(constant_z),
                   diffusion3_expression(insulated_z))
    statements = []
    for variant, expr in enumerate(expressions):
        target = float(expected + (1 if sabotage and variant == 2 else 0))
        statements.extend((
            f'    result = evaluate_math_expression("{expr}")',
            f'    if not result.valid or not near(result.result.value,{target}) '
            f'{{ return {800 + 3 * index + variant} }}',
        ))
    return source.replace(MARKER, "\n".join(statements) + "\n" + MARKER)


class DiffusionDimensionalReductionTests(unittest.TestCase):
    def test_all_seeded_exact_embeddings(self):
        cases = lifted_cases()
        self.assertEqual(len(cases), 9)
        self.assertTrue(any(expected != 0 for _, expected, _, _ in cases))
        for _, expected, constant_z, insulated_z in cases:
            self.assertEqual(diffusion3(constant_z), expected)
            self.assertEqual(diffusion3(insulated_z), expected)
            self.assertEqual(constant_z[5], constant_z[0])
            self.assertEqual(constant_z[6], constant_z[0])
            self.assertEqual(insulated_z[11:13], (0, 0))
            self.assertNotEqual(insulated_z[5], insulated_z[0])

    def test_invalid_coefficients_and_spacing_fail_closed(self):
        _, _, constant_z, insulated_z = lifted_cases()[0]
        with self.assertRaises(ValueError):
            diffusion3(constant_z[:11] + (Fraction(-1),) + constant_z[12:])
        with self.assertRaises(ValueError):
            diffusion3(insulated_z[:15] + (Fraction(0),))
        with self.assertRaises(ValueError):
            diffusion3(constant_z[:-1])

    def test_injection_is_deterministic_bounded_and_sabotage_detectable(self):
        for index in range(CELL_COUNT):
            source = inject_reduction_assertions(MARKER, index=index)
            self.assertEqual(source.count("evaluate_math_expression"), 3)
            self.assertEqual(source, inject_reduction_assertions(MARKER, index=index))
            self.assertNotEqual(source, inject_reduction_assertions(
                MARKER, index=index, sabotage=True))
        with self.assertRaises(AssertionError):
            inject_reduction_assertions(MARKER, index=CELL_COUNT)
        with self.assertRaises(AssertionError):
            inject_reduction_assertions(MARKER + MARKER)


if __name__ == "__main__":
    unittest.main()
