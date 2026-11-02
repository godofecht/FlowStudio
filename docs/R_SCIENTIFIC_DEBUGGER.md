# Native R scientific conditional breakpoints

The native FlowStudio R debugger uses the existing loopback-only Flow HTTP
server and persistent Rscript kernel. A conditional target has the form
`line?variable<=threshold`, for example
`8?fs_scientific_http<=1e-2,9?fs_scientific_http<=1e-2`.

The R kernel, the browser debugger panel, and the native HTTP client now
accept finite scientific notation with up to four exponent digits, including
signed exponents, signed finite thresholds and representable subnormals.
Nonzero literals that underflow to zero, nonfinite overflow, malformed
exponents, injection, invalid source lines and more than 64 targets are
rejected before expression evaluation. The debugger compares a scalar,
non-object, finite numeric workspace binding; it never evaluates the
condition as R code. This is a cooperative top-level expression debugger,
not an instruction-level debugger.

## Reproduce

```sh
node --test tests/browser_native_r_debugger.test.js
python3 tests/http_smoke.py --help
python3 scripts/verify_native.py --require-r
```

The full native acceptance is invoked by `scripts/verify_native.py` on
Linux/macOS CI. It starts the real compiler and HTTP server, invokes
`/api/debug/r/start`, rejects malformed targets with HTTP 422 while
preserving the paused interpreter, then continues through the exact
binary-halving trajectory. The first `<=1e-2` breakpoint occurs before
expression 9, with `fs_scientific_http == 0.0078125`; completing the
trajectory yields `0.00390625`. A subsequent ordinary R HTTP request
verifies persistent state. Ubuntu physical Chromium repeats the conditional
breakpoint, preflight rejection and watch evaluation through the actual
workspace controls.

The checked-in browser tests also cover `.5e-8`, `-2.5E+3`,
`5e-324`, exponent overflow and underflow, malformed literals and
expression injection. Source, response and IPC limits are unchanged.
No hosted CI configuration is modified.

This adds one R debugger capability; it does not establish general
compiler-generated multidimensional Flow `field` evolution, full
instruction-level R debugging or complete RStudio parity.
