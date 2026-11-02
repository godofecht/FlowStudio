# Heterogeneous two-dimensional Neumann diffusion qualification

Seed **20261102** defines a 4×4 nonperiodic grid, 24 independent positive
interior shared-face conductances, anisotropic spacings 1/2 m and 3/4 m,
and 16 exact rational initial values. The boundary imposes zero **normal
flux** on every external face; there are no periodic wraps or ghost cells.

An independent Python `Fraction` oracle evaluates 32 forward-Euler steps at
`dt=1/64`, preserving all 33 states. It asserts exact mass conservation,
zero net flux, the discrete Green identity, strictly decreasing quadratic
energy, the maximum principle, 16+16 restart equivalence, deterministic
replay and axis-transpose covariance with swapped spacings and conductances.

The production Flow mathematical compiler executes **20** `fluxdiv2`
expressions: all 16 initial cells and all four corners after 32 steps.
The live `/api/check/flow` and `/api/run/flow` endpoints must accept each
three-or-fewer-case batch under the 128 KiB source ceiling. Deliberately
corrupting an expected result must compile, fail execution with HTTP 422,
and leave the real server usable for a subsequent successful run. The native
Flow runtime computes these sampled stencils; the 32-step trajectory is
verified by the independent Python oracle, not by a compiler-generated field.

Reproduce the independent exact tests:

```sh
python3 -m unittest discover -s tests -p 'test_neumann_diffusion2.py' -v
```

The HTTP acceptance requires the production server on localhost port 8751:

```sh
python3 tests/http_neumann_diffusion2_smoke.py
```

The complete Linux/macOS native build and live HTTP gate is:

```sh
python3 scripts/verify_native.py --require-r
```

This qualifies no-flux boundary semantics for scalar stencils. It does not
claim generalized compiler-generated multidimensional `field` lowering or
full RStudio parity. Independent macOS physical Chromium remains a separate
verification target.
