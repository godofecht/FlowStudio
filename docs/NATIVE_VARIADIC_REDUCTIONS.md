# Native Flow variadic scalar reductions

The Flow 2.0 mathematical source parser now lowers `sum(a, ...)` and
`product(a, ...)` into executable typed postfix IR, opcodes 73 and 74.
Both accept **one to eight** eagerly evaluated scalar arguments. The
instruction's existing `exponent` field records the exact argument count.
This is a bounded source-level variadic call implementation, not yet a
general upstream Flow grammar or first-class tensor reduction.

`sum(1m, 2m, 3m)` evaluates to `6m`; every input must have the same
SI dimensions. `product(2m, 3s, 4K, 5kg)` evaluates to `120` with
length × time × temperature × mass dimensions. Inputs may have different
units for `product`. Both operations reject predicates, malformed calls,
more than eight arguments, out-of-range numeric intermediates and
unbounded SI exponents. Static inference uses the same arity and
dimensional rules but intentionally does not predict numerical overflow.

Calls compose with other expressions and equations, including
`product(sum(1m, 2m), 2s)` and `sum(1m, 2m, 3m) = 6m`.
Implicit multiplication such as `2sum(1, 2, 3)` is lowered through
the same native multiplication IR rather than text substitution.

Run `flow run src/math_variadic_reductions_smoke.flow` for 31
native numerical, source-span, dimensional and negative assertions.
`tests/http_variadic_reductions_smoke.py` compiles and executes the
checked-in source against the live localhost native Flow HTTP server.
It also compiles a deliberately sabotaged numerical expectation and
requires a real HTTP 422 runtime failure. Linux and macOS CI execute
both suites, alongside the checked-in Navier–Stokes and heat programs.

General equation ASTs, arbitrary-rank tensor types, native
Navier–Stokes and computed multidimensional visualization remain
separate unfinished work.
