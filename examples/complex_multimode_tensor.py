"""Four-mode, 2D anisotropic tensor diffusion; independent Fourier acceptance.

Runs the production explicit-midpoint solver from spectral_interop_python.
Every output cell is checked against a separately derived discrete Fourier
amplification factor, not against a second numerical time integrator.
"""
from __future__ import annotations

import json
import math
from spectral_interop_python import integrate

GRID = 24
BASE = 50.0
DURATION = 0.04
TENSOR = (0.011, 0.017, 0.003)
# Nontrivial phases, signed wave numbers and independent mode amplitudes.
MODES = ((1, 2, 5.0, 0.3), (3, -2, -3.0, -0.7),
         (4, 5, 1.5, 1.1), (7, 1, 0.8, -0.4))


def mode(x: int, y: int, wave_x: int, wave_y: int, phase: float) -> float:
    return math.cos(2.0 * math.pi * (wave_x * x + wave_y * y) / GRID + phase)


def eigenvalue(wave_x: int, wave_y: int) -> float:
    # Symbol of Dxx*dxx + Dyy*dyy + 2*Dxy*dxy for the periodic stencil.
    xx, yy, xy = TENSOR
    return (-4.0 * GRID**2 * xx * math.sin(math.pi * wave_x / GRID)**2
            -4.0 * GRID**2 * yy * math.sin(math.pi * wave_y / GRID)**2
            -2.0 * GRID**2 * xy * math.sin(2.0 * math.pi * wave_x / GRID)
            * math.sin(2.0 * math.pi * wave_y / GRID))


def reference(steps: int | None) -> list[float]:
    output = []
    for x in range(GRID):
        for y in range(GRID):
            value = BASE
            for wave_x, wave_y, amplitude, phase in MODES:
                rate = eigenvalue(wave_x, wave_y)
                if steps is None:
                    gain = math.exp(rate * DURATION)
                else:
                    z = rate * DURATION / steps
                    gain = (1.0 + z + 0.5 * z*z)**steps
                value += amplitude * gain * mode(x, y, wave_x, wave_y, phase)
            output.append(value)
    return output


def initial() -> list[float]:
    return [BASE + sum(amplitude * mode(x, y, wx, wy, phase)
                       for wx, wy, amplitude, phase in MODES)
            for x in range(GRID) for y in range(GRID)]


def solve(values: list[float], steps: int, duration: float = DURATION) -> list[float]:
    return integrate(values, duration, steps, *TENSOR)


def max_error(left: list[float], right: list[float]) -> float:
    return max(abs(a-b) for a,b in zip(left,right))


def verify() -> dict[str, object]:
    source = initial()
    exact = reference(None)
    errors = []
    for steps in (20, 40, 80):
        computed = solve(source, steps)
        discrete = reference(steps)
        if max_error(computed, discrete) > 3e-10:
            raise AssertionError(f"{steps}-step cellwise discrete Fourier oracle failed")
        errors.append(max_error(computed, exact))
    if not (errors[0] > 3.4*errors[1] and errors[1] > 3.4*errors[2]):
        raise AssertionError(f"RK2 refinement failed: {errors}")
    final = solve(source, 80)
    if abs(sum(final)/len(final)-BASE) > 2e-11:
        raise AssertionError("mass conservation failed")
    if sum((v-BASE)**2 for v in final) >= sum((v-BASE)**2 for v in source):
        raise AssertionError("diffusive energy did not decay")
    if final != solve(source, 80):
        raise AssertionError("non-deterministic replay")
    half = solve(source, 40, DURATION/2)
    if max_error(final, solve(half, 40, DURATION/2)) > 3e-11:
        raise AssertionError("semigroup consistency failed")
    # Linearity of the actual PDE operator, not just the reference formula.
    centered = [v-BASE for v in source]
    centered_final = solve(centered, 80)
    if max_error(final, [BASE+v for v in centered_final]) > 3e-10:
        raise AssertionError("linearity failed")
    # Periodic translation equivariance for both dimensions.
    shifted = [source[((x-3)%GRID)*GRID+(y-5)%GRID]
               for x in range(GRID) for y in range(GRID)]
    shifted_final = solve(shifted, 80)
    expected_shift = [final[((x-3)%GRID)*GRID+(y-5)%GRID]
                      for x in range(GRID) for y in range(GRID)]
    if max_error(shifted_final, expected_shift) > 3e-10:
        raise AssertionError("periodic translation failed")
    # Invalid physical tensors, unstable steps, resource limits and NaN fail closed.
    invalid = ((source, -0.01, 80, *TENSOR),
               (source, DURATION, 0, *TENSOR),
               (source, DURATION, 2001, *TENSOR),
               (source, DURATION, 80, 0.01, 0.01, 0.02),
               (source, 100.0, 1, *TENSOR),
               ([float('nan')] + source[1:], DURATION, 80, *TENSOR))
    for args in invalid:
        try:
            integrate(*args)
        except ValueError:
            continue
        raise AssertionError("invalid physical/resource input was accepted")
    return {"grid": GRID, "modes": len(MODES), "steps": 80,
            "max_discrete_error": max_error(final, reference(80)),
            "temporal_errors": errors, "mean": sum(final)/len(final)}


if __name__ == "__main__":
    print("complex-multimode-ok " + json.dumps(verify(), allow_nan=False, separators=(",", ":")))
