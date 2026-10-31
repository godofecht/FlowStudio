# Native four-unknown, variable-count SI constraints: production acceptance

The checked-in `src/math_dimension_variable_four.flow` extends the upstream
Flow 2.0 mathematical postfix equation IR to solve **four unknown SI dimensions
from 4–16 equations**. It selects a full-rank quadruple with the native exact
4×4 determinant solver, then checks **every** original equation using the
production dimensional typechecker. The native
`src/math_dimension_variable_four_smoke.flow` executes 16 return-code
assertions covering dependent constraints, late pivots, all 16 slots,
contradictions, malformed equations, Unicode identifiers, square roots,
rank deficiency, nonintegral exponents, known units and invalid bounds.

## Reproduction

```sh
flow run src/math_dimension_variable_four_smoke.flow
python3 scripts/verify_native.py --require-r
```

The real native HTTP acceptance in `tests/http_smoke.py` concatenates eight
checked-in Flow modules, removes only local imports and `export` visibility,
and enforces the 128 KiB request limit. It calls `POST /api/check/flow`
and `POST /api/run/flow`, requires the native success marker
`native-math-variable-four-constraints-ok`, and sends two negative requests:
a modified late assertion must return execution HTTP 422, while a malformed
function declaration must return compiler HTTP 422.

`tests/native_math_plot_ui.mjs` exercises the same eight-module source through
physical Ubuntu Chromium, Monaco and the workbench Run button. It checks the
actual native program output in the visible console. Neither the HTTP path nor
the browser substitutes a Python dimensional solver, mock compiler or
precomputed result.

The source bundle is approximately 119 KiB at introduction. Native source
limits are 16 equations, four unknown dimensions and at most four known
dimension symbols; selection uses a bounded O(n^4) candidate search. No
arbitrary-rank inference, general multidimensional `field` lowering,
native Navier–Stokes or full RStudio parity is claimed.

**Qualification status at submission:** the previous native smoke was
included in Linux/macOS CI for PR #287. The new HTTP and Chromium acceptance
has not yet been independently qualified; record exact-head and post-merge
CI results only after they finish. Local native Flow/R and independent macOS
physical-browser interaction have not been executed in this environment.
