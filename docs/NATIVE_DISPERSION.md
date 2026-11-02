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

## Deterministic cross-runtime qualification

`tests/dispersion_oracle.py` uses seed 20261101 to construct 48 valid SI
population/sample dispersion cases, including reversed-order metamorphisms,
outliers, kilometre/metre conversion, dimensional assertions and exact-rational
variance expectations, plus 12 malformed, arity, type and overflow negatives.
`tests/http_dispersion_smoke.py` injects these into four production Flow
check/run HTTP batches and requires HTTP 422 on a corrupted numerical result.
`tests/http_dispersion_interop.py` runs the same 48 cases through persistent
base R `var`/`sd` and population SD, then a separate exact-Fraction CPython
HTTP oracle; corrupted results must fail and both interpreters must recover.
Sources are bounded to 128 KiB, response frames to 24 KiB. The five focused
Python source/oracle tests passed locally. Run the real native gate with
`python3 scripts/verify_native.py --require-r`; run standalone native smoke
with `flow run src/math_dispersion_smoke.flow` and
`flow run src/math_dispersion_http_smoke.flow` using the pinned Flow 2.0 toolchain.

[Exact-head Linux/macOS CI #41364214522](https://github.com/godofecht/FlowStudio/actions/runs/41364214522)
passed all four source/native jobs, including real HTTP and Ubuntu Chromium.
The initial browser bundle exceeded 128 KiB; the checked-in compact
16-constraint browser fixture now measures 126,274 bytes. Independent macOS
physical-browser interaction and local native Flow/R were not executed.
