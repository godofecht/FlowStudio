# Native Flow SI median/MAD: seeded production HTTP qualification

The checked-in `tests/robust_statistics_oracle.py` generates 60 deterministic
seed-20261103 cases independently of the Flow parser or runtime. Forty-eight
valid median/unscaled-median-absolute-deviation cases use exact Python
`Fraction` sorting, including odd/even arities, negative values, outliers,
repeated unit scales (`km` versus `m`), dimensionless values, seconds,
and reversed-order metamorphic pairs. Twelve invalid cases exercise malformed
arity and commas, mixed SI dimensions and predicate arguments.

`tests/http_robust_statistics_smoke.py` injects the exact rational
expectations and SI inference assertions into the checked-in
`src/math_robust_statistics_smoke.flow` entry point, then compiles and
executes three bounded 20-case batches via the **production** native
`/api/check/flow` and `/api/run/flow` endpoints. The transport limit is
128 KiB per source; any incorrect numerical assertion returns HTTP 422.
A separate corrupted-expectation program must compile successfully and
fail execution with HTTP 422. No Python evaluation substitutes for Flow
execution.

The existing `tests/http_variadic_reductions_smoke.py` invokes this gate,
so `python3 scripts/verify_native.py --require-r` requires it on the
existing Linux/macOS native CI path. Source-only rational/metamorphic and
size-limit tests are run by:

    python3 -m unittest discover -s tests -p 'test_robust_statistics_oracle.py' -v

These source tests do not establish native execution by themselves.
The smoke requires the actual Flow 2.0 compiler, running FlowStudio
HTTP server and native runtime. This does not implement symbolic indexed
statistics, vectorized tensors, generalized multidimensional `field`
lowering or full RStudio parity.
