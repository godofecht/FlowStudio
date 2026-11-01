# Parallel streaming statistics: native Flow/R/Python acceptance

The production Flow 2.0 module `src/stats.flow` now exposes
`summary_merge(left, right)`, a pairwise Chan–Golub–LeVeque merge for
disjoint Welford summaries. This permits independently accumulated partitions
to be reduced without rereading their source observations. The sample variance
retains Bessel's correction; empty summaries are identities, and count, mean,
second central moment, minimum and maximum are merged together.

The checked-in `src/stats_smoke.flow` executes 1,024 deterministic observations
`1e9 + ((37*i+19) mod 251)/8` with seed coefficients 37 and 19. The values
have a large baseline to expose cancellation in naive sums of squares. Four
interleaved 256-element partitions are merged in balanced, left-associated and
permuted trees, and compared with forward/reverse serial Welford accumulation.
The native program also checks singleton/empty identities, extrema, sample
variance and a five-value analytical fixture. The expected mean is
`1000000015.6422119`, sample variance `82.06557894918343`, minimum
`1000000000` and maximum `1000000031.25`.

`tests/test_parallel_streaming_stats.py` independently computes the exact
sample mean and variance using rational arithmetic, checks partition
associativity and the explicit 4,096-observation oracle work limit.
`tests/http_streaming_stats.py`, invoked from the existing native HTTP
acceptance, inlines the **same checked-in Flow module** into the real
`/api/check/flow` and `/api/run/flow` source buffer (the file-based compiler
uses its normal relative module import). It independently compares native
output with actual persistent CPython `statistics.variance` and base-R
`var` kernels, requires HTTP 422 for a deliberately corrupted Flow
numerical expectation, and tests R/Python error recovery. Sources are bounded
under the server's 128 KiB Flow limit and 2 KiB for Python/1 KiB for R.
The Flow smoke also runs as a native Linux/macOS CI command.

Reproduce:

```sh
python3 -m unittest discover -s tests -p 'test_parallel_streaming_stats.py' -v
flow run src/stats_smoke.flow
python3 scripts/verify_native.py --require-r
```

The statistics merge assumes disjoint finite streams and counts that fit
signed 64-bit integers. It is not a general distributed scheduler, a native
Flow/R DataFrame bridge or complete RStudio parity. Report native CI and
production HTTP results separately from the independent Python oracle;
a locally passing oracle does not establish compiler execution.
