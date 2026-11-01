# Native Flow physical dispersion (bounded)

The executable native Flow 2.0 scalar compiler now lowers `stddev(x1,...,xn)`,
`sample_variance(x1,...,xn)`, and `sample_stddev(x1,...,xn)` through
`src/math_expression_source.flow` into typed postfix IR opcodes 83, 81, 82.
This is native execution, not Monaco editor completion.

`stddev` computes the population standard deviation using divisor `n`
and accepts 1–8 numeric samples. `sample_variance` and `sample_stddev`
use Bessel's correction (divisor `n - 1`) and require 2–8 samples.
All samples must have identical SI dimensions; Boolean predicates are rejected.
Variance has squared SI dimensions; both standard deviations preserve input
dimensions. Numerical intermediates are scaled by maximum absolute input
before computing centered second moments, avoiding premature overflow.
The 1e30 magnitude and bounded SI-exponent contracts remain enforced.

`src/math_dispersion_smoke.flow` has 36 actual native parser, analytical,
negative, SI-inference and equation assertions. `src/math_dispersion_http_smoke.flow`
and `tests/http_dispersion_smoke.py` compile and run a compact bundle through
the production Flow HTTP endpoints, and require HTTP 422 for a deliberately
corrupted numerical expectation. These are included in Linux/macOS CI and
`scripts/verify_native.py --require-r`. They do not claim general tensor
statistics, unified upstream Flow grammar, native Navier–Stokes or computed
multidimensional visualization.

Examples: `stddev(1m,3m)` = 1 m;
`sample_variance(1m,3m)` = 2 m²;
`sample_stddev(1m,3m)` = sqrt(2) m.
