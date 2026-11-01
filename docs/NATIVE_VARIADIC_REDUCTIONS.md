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

## Seeded production HTTP regression

`tests/variadic_oracle.py` generates 48 reproducible cases using Python's
standard-library integer arithmetic and seed `20261101`. Sixteen sums and
sixteen products include reversed-argument metamorphic pairs; eight more
cases nest products inside sums. Forty valid cases check exact expected
integer results, SI dimensions and static inference in the actual compiled
Flow runtime. Eight negative cases exercise zero and excessive arity,
incompatible dimensions, predicate rejection and numerical overflow. The
overflow case intentionally expects static type inference to succeed while
runtime arithmetic rejects the out-of-range value.

The production HTTP smoke injects these assertions into the checked-in
Flow main, enforces a **128 KiB** UTF-8 source ceiling, then compiles and
executes the result through `/api/check/flow` and `/api/run/flow`.
A second compilation changes exactly one expected integer, requiring
HTTP 422 on execution. No fake compiler or HTTP service is used.

Reproduce the independent Python generator tests with
`python3 -m unittest discover -s tests -p 'test_variadic_oracle.py' -v`.
The full production HTTP test is part of
`python3 scripts/verify_native.py --require-r` on Linux/macOS CI.

General equation ASTs, arbitrary-rank tensor types, native
Navier–Stokes and computed multidimensional visualization remain
separate unfinished work.
