# Bounded mathematical Flow PDE duration overrides

The two production mathematical Flow frontends execute checked-in PDE models
through `src/math_flow.py`. Navier–Stokes uses a pressure-projected finite
difference solver; heat uses a typed NumPy RK2 solver. Both reject invalid
runtime duration types and values *before* integrating or allocating an
unbounded trajectory. Runtime grid overrides remain exact integers in [8, 512].

## Reproduce

```sh
python3 -m pip install 'numpy==2.1.3'
python3 -m unittest discover -s tests -p 'test_math_flow_runtime_validation.py' -v
python3 src/math_flow.py examples/navier_stokes_smoke.flow --grid 16 --until 0.005
python3 src/math_flow.py examples/heat_piecewise_forcing.flow --grid 16 --until 0.005
python3 src/math_flow.py examples/heat_piecewise_forcing.flow --grid 16 --until nan
python3 src/math_flow.py examples/navier_stokes_smoke.flow --grid 16 --until inf
```

The first two CLI runs must return `ok: true`, with 5 and 50 numerical
steps respectively, 16×16 grids and finite observables. The last two must
exit with status 2 and structured errors, without running the integrators.
The checked-in Python tests independently execute each valid model twice,
assert deterministic numerical observables and verify rejection of booleans,
strings, Decimal, complex, NaN, infinities, zero, negative durations, integers
too large to represent as finite floats and finite durations exceeding the
200,000-step resource ceiling. The step-ratio guard also rejects overflow
before `math.ceil` is called.

## Verification boundary

This is a bounded Python/NumPy-backed mathematical Flow dialect, not upstream
Flow 2.0's compiler-generated multidimensional `field` lowering. The
repository's unchanged CI runs source tests on Linux/macOS and native Flow,
R/Python HTTP and physical Ubuntu Chromium acceptance. An isolated local
execution cannot substitute for those production checks. Full RStudio
parity remains incomplete.
