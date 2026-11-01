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

## Independent R/Python interoperability acceptance

The same 48 valid seed-20261103 native Flow cases also run through the
production persistent R and Python HTTP kernels. The R path explicitly uses
`mad(x, constant=1)`: base R's default scaling constant would otherwise
make its MAD numerically incompatible with the native unscaled Flow operator.
Kilometres are converted to metres before evaluation; seconds and
dimensionless samples are retained separately.

The checked-in `tests/http_robust_interop.py` sends all 48 cases to real
`/api/run/r`, validates numbered bounded output frames against the exact
rational oracle, then sends the actual R values to `/api/run/python`. The
Python kernel independently recomputes medians and MADs using
`statistics.median` on `fractions.Fraction` samples. A deliberately corrupted
finite result and a truncated frame must each return HTTP 422. The test
also verifies persistent R state and Python recovery. R sources are capped
at 128 KiB and frames at 12 KiB.

`tests/test_robust_interop_source.py` separately checks deterministic source
construction, exact oracle equivalence, source/frame limits and both negative
controls without claiming these source tests exercise the production runtime.
The existing `verify_native.py --require-r` gate invokes the real HTTP
interop through `http_variadic_reductions_smoke.py`, without changing hosted
CI configuration. This is scalar SI interoperability, not general tensor
statistics or full RStudio parity.
