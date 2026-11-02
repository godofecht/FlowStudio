# Finite PDE cell geometry and cell-step budget

The bounded NumPy-backed Flow PDE runtimes share a numerical preflight before
allocating state grids or beginning RK2 integration. It applies to both
Navier–Stokes and typed heat evolution. The preflight rejects more than
4,194,304 cell-steps (grid width × grid height × integration steps), and
cell spacings whose squares or inverse squares are zero, infinite or NaN in
IEEE-754 binary64. This is a finite-work/representability contract, not a
proof of numerical stability or full upstream Flow 2.0 PDE lowering.

## Reproduction

```sh
python3 -m pip install 'numpy==2.1.3'
python3 -m unittest discover -s tests -p 'test_math_flow_runtime_validation.py' -v
python3 src/math_flow.py examples/navier_stokes_smoke.flow --grid 16 --until 0.005
python3 src/math_flow.py examples/heat_piecewise_forcing.flow --grid 16 --until 0.005
python3 src/math_flow.py examples/navier_stokes_smoke.flow --grid 512 --until 0.005
python3 src/math_flow.py examples/heat_piecewise_forcing.flow --grid 512 --until 0.005
```

The first two commands must execute 50 real RK2 steps on a 16×16 grid and
return finite numerical observables with `ok: true`. The last two must
exit 2 with JSON errors containing `cell-step budget`, without allocating
the large state grids. The tests also exercise the exact allowed
512×512×16 budget and forbidden 512×512×17 boundary, tiny and huge
positive extents on both axes, structured CLI errors, and valid replay.
CLI subprocesses have 15-second timeouts.

The same preflight rejects parsed domain extents of `1e-300m` and
`1e308m` on either axis, which previously could lead to underflowed
cell squares or nonfinite reciprocal stencils. It does not silently
coarsen the grid or change the user's physical model.

## Verification boundary

This covers the bounded Python/NumPy dialect, not general compiler-generated
multidimensional `field` lowering in upstream Flow. Linux/macOS CI must
execute source tests, native Flow compilation, real R/Python HTTP and the
Ubuntu physical Chromium gate before the change is qualified. An independent
macOS physical browser and local native Flow/R remain separate unexecuted
checks until actually run. RStudio parity is incomplete.
