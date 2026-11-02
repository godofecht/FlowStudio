# 64-step conservative 1D diffusion: independent matrix qualification

Seed `20261102` deterministically selects a five-cell periodic temperature field
and five positive heterogeneous shared-face diffusivities. The exact-rational
oracle evolves the conservative explicit Euler scheme for 64 steps with
`dx = 2 m` and `dt = 1/16 s`. An independently assembled doubly stochastic
transition matrix, exponentiated by binary squaring, reproduces the entire
trajectory at selected steps. Assertions cover conservation of total heat,
maximum principle, monotone quadratic energy, 32+32 restart, periodic
translation covariance, deterministic replay, and malformed injection bounds.

At steps 1, 8, 32 and 64, **all five cell derivatives** (20 expressions)
are independently evaluated through the production native Flow mathematical
compiler and real `/api/check/flow` and `/api/run/flow` endpoints. The oracle
supplies bounded decimal literals for the 64-step states and exact-rational
expected rates; the native numerical comparison uses the checked-in `near`
tolerance and checks SI K/s. Every batch contains at most three expressions
and has a 128 KiB source limit. Corrupting one expectation must still compile
but return HTTP 422 at execution. The production runtime evaluates the sampled
stencils; the 64-step time integration itself is independently checked in
Python, **not** represented as native Flow evolution.

Reproduction with actual FlowStudio dependencies:

```sh
python3 -m unittest discover -s tests -p 'test_diffusion1_long_horizon.py' -v
flow run src/math_diffusion1_smoke.flow
python3 scripts/verify_native.py --require-r
```

The native verification script starts the production Flow router and invokes
`tests/http_diffusion1_long_horizon.py`. Linux/macOS CI is the authoritative
native verification. An isolated Python pass does not establish native
compilation, HTTP execution, physical-browser coverage or RStudio parity.
General compiler-generated multidimensional `field` lowering and boundary
semantics remain separate milestones.

## Full-trajectory R/Python HTTP qualification

The mandatory native HTTP runner also evolves **all 65 five-cell states**
(initial plus 64 updates) in the persistent base-R interpreter, using a
direct conservative shared-face stencil. It checks finite values, conserved
mass and nonincreasing quadratic energy after every update, and emits a
bounded, ordered 65-frame trace. The host independently checks every
reported value against the exact-Fraction Python trajectory.

A separate persistent CPython HTTP execution constructs the five-by-five
doubly stochastic transition matrix from the seeded coefficients and
verifies **all 325 values** using exact rational matrix-vector updates.
Deliberate step-32 numerical corruption and a truncated frame must each
return HTTP 422. Both interpreter sessions are checked for recovery.
Sources are capped at 128 KiB and output frames at 24 KiB; the
three isolated payload tests execute the generated Python program in a
real CPython subprocess with a 15-second timeout.

This supplements, but does not replace, the 20 native Flow mathematical
stencil executions. The 64-step integration is executed by base R and
independently by Python, **not by the native Flow PDE time integrator**.
The distinction matters for parity claims.

```sh
python3 -m unittest discover -s tests -p 'test_diffusion1_long_horizon_interop.py' -v
python3 scripts/verify_native.py --require-r
```

Linux/macOS native CI must pass before claiming real R/Python HTTP
qualification. No hosted CI workflow changes are necessary.
