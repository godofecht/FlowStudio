"""Independent nonlinear Gray-Scott oracle for two compiler-generated Flow fields.

The reference is standard-library Python, not a translation of the Flow
compiler output. Production HTTP and physical Chromium acceptance are separate.
"""
import math
import re
import unittest
from pathlib import Path

SOURCE = Path(__file__).resolve().parents[1] / "examples/native_field_grayscott64.flow"
N = 64
RATIO_U = 0.22
RATIO_V = 0.09
FEED = 0.035
KILL = 0.062


def initial():
    u = [1.0] * N
    v = [0.0] * N
    for i in range(22, 42):
        u[i] = 0.47 + 0.004 * (i - 22)
        v[i] = 0.27 - 0.003 * (i - 22)
    return u, v


def reference(u, v, steps, ratio_u=RATIO_U, ratio_v=RATIO_V,
              feed=FEED, kill=KILL):
    u, v = u[:], v[:]
    for _ in range(steps):
        new_u, new_v = u[:], v[:]
        for i in range(1, N - 1):
            reaction = u[i] * v[i] ** 2
            lap_u = u[i - 1] + u[i + 1] - 2 * u[i]
            lap_v = v[i - 1] + v[i + 1] - 2 * v[i]
            new_u[i] = u[i] + ratio_u * lap_u + feed * (1 - u[i]) - reaction
            new_v[i] = v[i] + ratio_v * lap_v - (feed + kill) * v[i] + reaction
        u, v = new_u, new_v
    return u, v


def expected(name):
    source = SOURCE.read_text(encoding="utf-8")
    match = re.search(
        rf"let {re.escape(name)}: array<f64, 64> = \[(.*?)\]", source, re.S)
    if match is None:
        raise AssertionError(f"missing checked-in {name} oracle")
    values = [float(value.strip()) for value in match.group(1).split(",")
              if value.strip()]
    if len(values) != N:
        raise AssertionError(f"{name}: expected 64 values, got {len(values)}")
    return values


def max_error(a, b):
    return max(abs(x - y) for x, y in zip(a, b))


class NativeGrayScott64Oracle(unittest.TestCase):
    def test_all_384_nonlinear_cell_checkpoints(self):
        initial_u, initial_v = initial()
        for steps in (32, 128, 256):
            u, v = reference(initial_u, initial_v, steps)
            self.assertLess(max_error(u, expected(f"expectedU{steps}")), 5e-12)
            self.assertLess(max_error(v, expected(f"expectedV{steps}")), 5e-12)

    def test_semigroup_and_deterministic_replay(self):
        u0, v0 = initial()
        u128, v128 = reference(u0, v0, 128)
        u256, v256 = reference(u0, v0, 256)
        ucomposed, vcomposed = reference(u128, v128, 128)
        self.assertLess(max_error(u256, ucomposed), 1e-13)
        self.assertLess(max_error(v256, vcomposed), 1e-13)
        self.assertEqual((u256, v256), reference(u0, v0, 256))
        self.assertEqual((u0, v0), reference(u0, v0, 0))

    def test_positivity_dirichlet_and_nontrivial_pattern(self):
        u0, v0 = initial()
        for steps in (32, 128, 256):
            u, v = reference(u0, v0, steps)
            self.assertTrue(all(math.isfinite(x) and 0 <= x <= 1.5
                                for x in u + v))
            self.assertEqual((u[0], u[-1], v[0], v[-1]),
                             (1.0, 1.0, 0.0, 0.0))
        u32, v32 = reference(u0, v0, 32)
        self.assertGreater(v32[32], v0[32])
        self.assertLess(u32[32], u0[32])

    def test_diffusion_and_kill_mutations_detected(self):
        u0, v0 = initial()
        u, v = reference(u0, v0, 256)
        wrong_diffusion, _ = reference(u0, v0, 256, ratio_u=0.11)
        _, wrong_kill = reference(u0, v0, 256, kill=0.07)
        self.assertGreater(max_error(u, wrong_diffusion), 0.01)
        self.assertGreater(max_error(v, wrong_kill), 0.01)

    def test_nonlinear_reaction_is_not_linear_diffusion(self):
        u0, v0 = initial()
        u, v = reference(u0, v0, 128)
        no_reaction_u, no_reaction_v = u0[:], v0[:]
        for _ in range(128):
            nu, nv = no_reaction_u[:], no_reaction_v[:]
            for i in range(1, N - 1):
                nu[i] += RATIO_U * (no_reaction_u[i - 1] -
                                    2 * no_reaction_u[i] + no_reaction_u[i + 1])
                nv[i] += RATIO_V * (no_reaction_v[i - 1] -
                                    2 * no_reaction_v[i] + no_reaction_v[i + 1])
            no_reaction_u, no_reaction_v = nu, nv
        self.assertGreater(max_error(u, no_reaction_u), 0.05)
        self.assertGreater(max_error(v, no_reaction_v), 0.01)

    def test_real_field_syntax_guards_and_bounded_work(self):
        source = SOURCE.read_text(encoding="utf-8")
        for name in ("U", "V"):
            self.assertIn(f"field {name} : f64[64] on Line", source)
            self.assertIn(f"{name} evolves as laplacian({name})", source)
            self.assertIn(f"{name}_field_step(", source)
        self.assertIn("currentU[i] * currentV[i] * currentV[i]", source)
        self.assertIn("steps > 1024", source)
        self.assertIn("ratioU > 0.5", source)
        self.assertIn("ratioV > 0.5", source)
        self.assertIn("sentinelU[i] != 777.0 or sentinelV[i] != 777.0", source)
        self.assertIn("native-field-grayscott64-ok", source)
        self.assertIn('println("FLOWSTUDIO_FIELD_V1 64 2")', source)
        self.assertIn('print(afterU256[i])', source)
        self.assertIn('print(afterV256[i])', source)
        self.assertIn('println("FLOWSTUDIO_FIELD_END")', source)


if __name__ == "__main__":
    unittest.main()
