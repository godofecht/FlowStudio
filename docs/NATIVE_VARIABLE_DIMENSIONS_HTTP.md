# Native variable-count SI constraints: production HTTP and browser acceptance

This qualification executes the actual Flow 2.0 implementation in
`src/math_dimension_variable.flow` with the checked-in
`src/math_dimension_variable_smoke.flow` program. The program exercises
three unknown physical dimensions over 3–16 equations, including
rank-deficient prefixes, late independent constraints, Unicode identifiers,
nested roots, additive consistency checks, contradictory equations, malformed
equations, nonintegral SI exponents and bounded equation counts.

The production HTTP smoke in `tests/http_smoke.py` stages the eight
checked-in native modules into a single 114,881-byte UTF-8 Flow source
(the anonymous compiler does not resolve project-relative imports).
It requires successful `POST /api/check/flow` and
`POST /api/run/flow`, and an executable success marker. A deliberately
corrupted native assertion must produce HTTP 422 on execution. A malformed
function signature must produce HTTP 422 on compile. The acceptance has a
128-KiB source budget and does not use a Python interpretation of the solver.

`tests/native_math_plot_ui.mjs` additionally enters the same checked-in
source into the real Monaco editor and clicks the production Run control
in Chromium, then waits for the native executable's success marker.
This verifies the browser-to-native-HTTP path, not merely DOM fixtures.

Reproduce on a host with the pinned Flow 2.0.0 compiler, R and Python:

```sh
flow run src/math_dimension_variable_smoke.flow
python3 scripts/verify_native.py --require-r
```

The native acceptance is part of the existing Linux/macOS CI matrix.
The physical Chromium check runs on Ubuntu. macOS physical-browser
interaction, general N-unknown symbolic solving, multidimensional
compiler-generated `field` lowering and full RStudio parity remain
unestablished. Qualification status must be determined from exact-head CI,
not inferred from this document.
