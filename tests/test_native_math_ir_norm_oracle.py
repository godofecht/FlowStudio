"""Independent numerical oracle for bounded native Flow physical norms.

The actual Flow 2.0 compiler and HTTP acceptance execute
src/math_expression_ir_smoke.flow in existing cross-platform CI. This Python
oracle independently checks the documented Newton/scaled-norm algorithms,
not the native compiler. All random inputs are reproducible and bounded.
"""
from __future__ import annotations

import math
from pathlib import Path
import random
import unittest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "src" / "math_expression_ir.flow"
SMOKE = ROOT / "src" / "math_expression_ir_smoke.flow"
MAX_MAGNITUDE = 1e30


def bounded_newton_root(value: float) -> float:
    if not math.isfinite(value) or not 0 <= value <= MAX_MAGNITUDE:
        raise ValueError("radicand outside native range")
    if value == 0:
        return 0.0
    estimate = value if value > 1 else 1.0
    for _ in range(72):
        estimate = 0.5 * (estimate + value / estimate)
    return estimate


def bounded_norm(first: float, second: float) -> float:
    if not all(math.isfinite(value) and abs(value) <= MAX_MAGNITUDE
               for value in (first, second)):
        raise ValueError("operand outside native range")
    largest = max(abs(first), abs(second))
    smallest = min(abs(first), abs(second))
    if largest == 0:
        return 0.0
    result = largest * bounded_newton_root(1 + (smallest / largest) ** 2)
    if result > MAX_MAGNITUDE:
        raise ValueError("norm exceeds native range")
    return result


class NativePhysicalNormOracle(unittest.TestCase):
    def test_newton_roots_over_sixty_decades(self):
        generator = random.Random(20261030)
        values = [0.0, 1e-30, 1e-15, 1.0, 2.0, 25.0, 1e15, 1e30]
        values.extend(10 ** generator.uniform(-30, 30) for _ in range(1024))
        for value in values:
            expected = math.sqrt(value)
            self.assertAlmostEqual(bounded_newton_root(value), expected,
                                   delta=3e-15 * expected if expected else 0.0)

    def test_scaled_hypotenuse_against_math_hypot(self):
        generator = random.Random(13002026)
        cases = [(0, 0), (3, 4), (-3, -4), (1e-30, 1e-30),
                 (1e30, 1e-30), (1e15, -1e15)]
        cases.extend((generator.choice((-1, 1)) * 10 ** generator.uniform(-30, 29),
                      generator.choice((-1, 1)) * 10 ** generator.uniform(-30, 29))
                     for _ in range(1024))
        for first, second in cases:
            expected = math.hypot(first, second)
            self.assertAlmostEqual(bounded_norm(first, second), expected,
                                   delta=4e-15 * expected if expected else 0.0)

    def test_bounds_and_overflow_rejection(self):
        for value in (-1, math.inf, -math.inf, math.nan, 1e31):
            with self.assertRaises(ValueError):
                bounded_newton_root(value)
        for first, second in ((1e30, 1e30), (math.inf, 1),
                              (math.nan, 1), (1e31, 0)):
            with self.assertRaises(ValueError):
                bounded_norm(first, second)

    def test_native_source_and_executable_assertions_present(self):
        source = SOURCE.read_text(encoding="utf-8")
        smoke = SMOKE.read_text(encoding="utf-8")
        for contract in ("positive_square_root", "even_dimension",
                         "half_dimension", "opcode == 20", "opcode == 21",
                         "opcode == 22", "not bounded_value"):
            self.assertIn(contract, source)
        for code in range(54, 68):
            self.assertIn(f"return {code} }}", smoke)
        self.assertIn('println("native-math-ir-ok")', smoke)


if __name__ == "__main__":
    unittest.main()
