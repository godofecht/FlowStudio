# Scientific-notation CPython breakpoints with an independent heat oracle

This qualification exercises the **real** persistent CPython debugger through
the Flow-owned localhost HTTP router, then compares the resulting PDE field
against an independent discrete sine eigenmode oracle and **real persistent
base R HTTP**. It is not a Python mock, a JS simulation, or a replacement for
native Flow compilation. The existing mandatory native Flow compiler,
numerics, notebooks, plotting, and physical Ubuntu Chromium gates remain.

The debugger now accepts bounded numeric comparisons such as
`residual<=1e-3`, `residual>=-2.5E+3`, `residual>.5e-8` and
`residual<1e-320`. It does not evaluate arbitrary expressions or invoke
user-defined comparisons. Nonfinite thresholds, nonzero decimals that
underflow to zero, invalid exponents, and expression injection are rejected
before any source executes.

## Manufactured PDE and independent oracle

The deterministic 65-point, 64-interval, fixed-zero-boundary heat state is

```text
u_i(0) = sin(pi*i/64) + 0.25*sin(3*pi*i/64)
u_i(k+1) = u_i(k) + 0.4*(u_(i-1)(k) - 2*u_i(k) + u_(i+1)(k))
```

for interior cells 1..63. Both boundary cells remain fixed at zero. The
independent spectral oracle uses the eigenvalues
`q_m = 1 - 1.6*sin(m*pi/128)^2` for modes m=1 and m=3 and predicts every
cell at step k as
`q_1^k*sin(pi*i/64) + 0.25*q_3^k*sin(3*pi*i/64)`.

The debugger is asked to stop at the first iteration where the maximum
absolute Euler update residual is at most `1e-3`. The independent
spectral oracle predicts the first hit at **zero-based iteration 160**;
iteration 159 must still exceed the threshold. The debugger must expose
that actual iteration and residual in its paused CPython frame, reject
concurrent normal Python execution, resume to completion, and persist the
field. Five interior values (indices 1, 16, 32, 48, 63) must agree within
2e-12 with both the spectral oracle and a separate base R calculation
through `/api/run/r`.

The negative HTTP controls deliberately submit overflow, underflow and
expression injection conditions; each must return HTTP 422. The normal
Python kernel must remain usable afterward. The fixture is seed-free
(manufactured deterministic sine modes), has a maximum of 192 Euler steps,
64 intervals, 12,288 maximum cell-steps, 128 KiB HTTP request and 24 KiB
response ceilings. No external packages or data are required.

## Reproduce

With a production Flow toolchain and R installed:

```sh
python3 -m unittest discover -s tests -p 'test_python_debugger.py' -v
python3 scripts/verify_native.py --require-r
npm test
python3 -m unittest discover -s tests -p 'test_*.py'
```

The browser breakpoint parser and the browser HTTP request validator
must both accept the kernel's bounded scientific grammar. To reproduce the
native-workspace regression from [PR #406](https://github.com/godofecht/FlowStudio/pull/406):

```sh
node --test tests/browser_python_conditional_breakpoints.test.js
```

The Node test verifies exponent signs, leading-dot mantissas, subnormal
literals, malformed exponent and expression rejection, and the request body
sent to `/api/debug/python/start`. Its fetch stub checks only transport
construction. Separately, the existing mandatory `tests/native_ui.mjs`
uses actual Chromium, the real Flow-owned HTTP server, and persistent CPython
to pause on `4?residual<=1e-3` at the analytically predicted first crossing
(iteration 2 for a geometric 0.5 initial residual). It then stops the real
debugger before the next browser acceptance. Neither browser test substitutes
for the full 65-cell heat PDE/R/Python HTTP oracle below.

The HTTP test is `tests/http_debugger_scientific_smoke.py`, registered
as mandatory in `scripts/verify_native.py` on both Linux and macOS.
The spectral source and oracle are checked in together in
`tests/debugger_scientific_fixture.py`.

**Qualification status:** local isolated numerical and grammar checks
must not be confused with the complete repository tests, live native
Flow/R/Python HTTP or physical browser. Those require exact-head CI and
independent verification. This change improves scientific debugging and
R/Python parity, not generalized compiler-generated multidimensional
`field` lowering or full RStudio parity.
