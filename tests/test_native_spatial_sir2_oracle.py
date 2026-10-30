"""Independent six-state nonlinear reaction-diffusion oracle for native Flow.

This is a numerical cross-check, not a replacement for the Flow compiler.
The checked-in Flow executable runs in Linux/macOS CI, production HTTP and
the Ubuntu physical Chromium editor.
"""
import math
from pathlib import Path
import re
import unittest

SOURCE = Path(__file__).resolve().parents[1] / "examples/native_spatial_sir2.flow"
INITIAL = (0.98, 0.02, 0.0, 0.90, 0.05, 0.05)
RATES = (1.7, 0.35, 0.12, 0.08, 0.05)
DURATION = 1.75


def derivative(state, beta=1.7, gamma=0.35, ds=0.12, di=0.08, dr=0.05):
    s0, i0, r0, s1, i1, r1 = state
    return (
        -beta*s0*i0 + 2*ds*(s1-s0),
        beta*s0*i0-gamma*i0 + 2*di*(i1-i0),
        gamma*i0 + 2*dr*(r1-r0),
        -beta*s1*i1 + 2*ds*(s0-s1),
        beta*s1*i1-gamma*i1 + 2*di*(i0-i1),
        gamma*i1 + 2*dr*(r0-r1),
    )


def rk4(initial=INITIAL, steps=64, duration=DURATION, rates=RATES):
    state = tuple(initial)
    dt = duration / steps
    for _ in range(steps):
        k1 = derivative(state, *rates)
        k2 = derivative(tuple(x + dt*y/2 for x, y in zip(state, k1)), *rates)
        k3 = derivative(tuple(x + dt*y/2 for x, y in zip(state, k2)), *rates)
        k4 = derivative(tuple(x + dt*y for x, y in zip(state, k3)), *rates)
        state = tuple(x + dt*(a+2*b+2*c+d)/6
                      for x, a, b, c, d in zip(state, k1, k2, k3, k4))
    return state


def max_error(a, b):
    return max(abs(x-y) for x, y in zip(a, b))


def swap(state):
    return (*state[3:], *state[:3])


class SpatialSIR2Oracle(unittest.TestCase):
    def test_checked_in_reference_all_six_components(self):
        source = SOURCE.read_text(encoding="utf-8")
        self.assertIn("flow SpatialSIR2 {", source)
        self.assertIn("SpatialSIR2_step(&state, dt)", source)
        self.assertIn('println("native-spatial-sir2-ok")', source)
        block = source.split("function independentReference()", 1)[1].split("return expected", 1)[0]
        fields = ("susceptibleLeft", "infectedLeft", "recoveredLeft",
                  "susceptibleRight", "infectedRight", "recoveredRight")
        reference = rk4(steps=32768)
        self.assertLess(max_error(reference, rk4(steps=65536)), 2e-13)
        for name, value in zip(fields, reference):
            match = re.search(r"expected\." + name + r"\s*=\s*([0-9.]+)", block)
            self.assertIsNotNone(match, name)
            self.assertAlmostEqual(float(match.group(1)), value, delta=3e-13)

    def test_fourth_order_convergence_and_resource_budget(self):
        exact = rk4(steps=32768)
        errors = [max_error(rk4(steps=n), exact) for n in (4, 8, 16, 32, 64)]
        self.assertGreater(errors[0], 1e-4)
        self.assertLess(errors[-1], 3e-8)
        for previous, current in zip(errors, errors[1:]):
            self.assertLess(current, 0.1*previous)
        source = SOURCE.read_text(encoding="utf-8")
        self.assertIn("steps > 8192", source)
        self.assertIn("duration <= 20.0", source)
        self.assertIn("rateBound", source)

    def test_mass_conservation_replay_and_semigroup(self):
        evolved = rk4()
        self.assertEqual(evolved, rk4())
        self.assertAlmostEqual(sum(evolved), 2.0, delta=1e-14)
        self.assertTrue(all(0 < value < 1 for value in evolved))
        half = rk4(steps=32, duration=DURATION/2)
        self.assertLess(max_error(rk4(half, 32, DURATION/2), evolved), 1e-14)
        self.assertEqual(rk4(duration=0), INITIAL)

    def test_cell_swap_and_time_rate_scaling(self):
        original = rk4()
        self.assertLess(max_error(rk4(swap(INITIAL)), swap(original)), 1e-14)
        scaled = rk4(duration=2*DURATION, rates=tuple(x/2 for x in RATES))
        self.assertLess(max_error(scaled, original), 1e-14)

    def test_exact_nonlinear_logistic_and_linear_decay_limits(self):
        logistic = rk4(steps=128, rates=(1.7, 0, 0, 0, 0))
        for cell in (0, 3):
            susceptible, infected = INITIAL[cell:cell+2]
            conserved = susceptible + infected
            growth = math.exp(1.7*conserved*DURATION)
            exact_infected = conserved*infected*growth/(susceptible+infected*growth)
            self.assertAlmostEqual(logistic[cell+1], exact_infected, delta=1e-8)
            self.assertAlmostEqual(logistic[cell], conserved-exact_infected, delta=1e-8)
            self.assertEqual(logistic[cell+2], INITIAL[cell+2])
        decay = rk4(steps=128, rates=(0, 0.35, 0, 0, 0))
        for cell in (0, 3):
            exact_infected = INITIAL[cell+1]*math.exp(-0.35*DURATION)
            self.assertAlmostEqual(decay[cell+1], exact_infected, delta=1e-8)
            self.assertAlmostEqual(decay[cell+2], INITIAL[cell+2] +
                                   INITIAL[cell+1]-exact_infected, delta=1e-8)

    def test_mutation_sensitivity_and_frozen_system(self):
        baseline = rk4()
        wrong_diffusion = rk4(rates=(1.7, 0.35, 0.12, 0, 0.05))
        wrong_recovery = rk4(rates=(1.7, 0, 0.12, 0.08, 0.05))
        self.assertGreater(max_error(baseline, wrong_diffusion), 1e-3)
        self.assertGreater(max_error(baseline, wrong_recovery), 1e-2)
        self.assertEqual(rk4(rates=(0, 0, 0, 0, 0)), INITIAL)


if __name__ == "__main__":
    unittest.main()
