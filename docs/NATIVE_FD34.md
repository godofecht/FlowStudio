# Native centered third and fourth derivatives

The production Flow 2.0 mathematical source parser now lowers two bounded,
executable, SI-aware scalar finite-difference functions into the typed postfix
IR. This is **not** general symbolic PDE grammar or a native Navier–Stokes
solver.

`fd3(fmm, fm, fp, fpp, h)` computes

`(fpp - fmm - 2(fp - fm)) / (2h³)`

from samples at `x-2h, x-h, x+h, x+2h` (opcode 92).
`fd4(fmm, fm, f0, fp, fpp, h)` computes

`(fmm - 4fm + 6f0 - 4fp + fpp) / h⁴`

from samples at `x-2h, x-h, x, x+h, x+2h` (opcode 93).
Both require a positive finite step, identically dimensioned scalar samples,
no predicates, and finite bounded arithmetic. Static inference derives
`[f]/[h]³` or `[f]/[h]⁴` without evaluating step magnitudes.
The step may carry any physical dimension (e.g. time), not just length.
Malformed arity and invalid types fail closed with source positions.

The native Flow 2.0 CLI smoke is:

```sh
flow run src/math_fd34_smoke.flow
```

Independent Python `Fraction` oracles exercise exact derivatives of
`x³` and `x⁴` at three spacings, and demonstrate second-order truncation
error (4:1 on refinement) for `x⁵` and `x⁶`. They also verify annihilation
of lower-degree polynomials. All 12 manufactured cases are injected into the
**real** native `/api/check/flow` and `/api/run/flow` endpoints in four
bounded requests; deliberate corruption must compile but fail execution
with HTTP 422. These tests are mandatory in Linux/macOS CI through
`scripts/verify_native.py --require-r`, alongside the checked-in
Python-backed Navier–Stokes program and physical Ubuntu Chromium acceptance.

No claim is made that editor completion, isolated Python oracle tests, or
static examples alone demonstrate native numerical execution. CI results
must be checked against the exact PR head before merge.
