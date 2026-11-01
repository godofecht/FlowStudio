# Native Flow Type-7 quantile: independently checked Flow/R/Python acceptance

This is a reproducible **production** acceptance test, not a substitute
implementation of Flow. It is stacked on the native SI-aware
`quantile(p, x1, ..., xn)` implementation in
[PR #359](https://github.com/godofecht/FlowStudio/pull/359).

## Reproduction

From the repository root, with the pinned Flow 2.0 toolchain, Python 3.12,
Rscript and Node.js installed:

```sh
python3 -m unittest discover -s tests -p 'test_quantile_oracle.py' -v
python3 scripts/verify_native.py --require-r
```

The native gate builds the actual Flow HTTP server, waits for its loopback
health response, and invokes `tests/http_variadic_reductions_smoke.py`,
which invokes `tests/http_quantile_smoke.py`. The source uses the production
Flow parser, typed expression IR, static dimension inference and native
`/api/check/flow` and `/api/run/flow` endpoints. The same server executes
the independent `/api/run/r` and `/api/run/python` checks through persistent
R and CPython kernels.

The seed is **20261104**. There are 48 valid cases, paired by reversed
argument order, and 12 malformed-arity, dimension, Boolean or out-of-range
probability negatives. Every valid expectation is a Python
`fractions.Fraction` Type-7 interpolation over exact SI-normalized integers.
Three batches of 20 cases are compiled and run by native Flow. An altered
expected result must still compile and must fail at execution with HTTP 422.

Base R computes `stats::quantile(..., type=7, names=FALSE)` on all 48
datasets. A separate persistent Python kernel recomputes each expected
result from rational order statistics; a changed value and a truncated frame
must both return HTTP 422. Both interpreters must remain usable afterwards.
Each HTTP source is bounded below 128 KiB, the result frame below 12 KiB,
and the native gate has a 120-second per-smoke deadline. The pure-Python
tests additionally exercise 300 independently seeded exact interpolation,
median and permutation comparisons.

## Verification status

**Local:** Two independent pure-Python oracle tests passed on the authoring
runtime; local Flow/R/browser tests were not run because the pinned Flow
compiler and Rscript were unavailable there.

**Hosted:** See [PR #360](https://github.com/godofecht/FlowStudio/pull/360)
for exact-head Ubuntu 24.04/macOS 15 CI, including actual Flow, HTTP, R,
Python and Ubuntu physical Chromium. Do not treat pending, skipped or
cancelled CI as passed. The upstream multidimensional `field` lowering
and overall RStudio parity are not addressed by this test.
