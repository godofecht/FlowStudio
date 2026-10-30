# Coupled nonlinear Gray-Scott fields (64 + 64 cells)

`examples/native_field_grayscott64.flow` declares two actual upstream
`field` / `laplacian` / Dirichlet systems, U and V, each with 64 cells.
The production compiler lowers each field's diffusion to its own generated
`_field_step`. The time integrator then couples both fields through the
nonlinear Gray-Scott reaction `U * V * V`, feed and kill kinetics, all
evaluated from the same old state (not operator splitting).

U has boundary 1/1 and diffusion ratio 0.22; V has boundary 0/0 and ratio
0.09. Feed is 0.035 and kill is 0.062. An asymmetric, deterministic 20-cell
perturbation evolves for 32, 128 and 256 steps. All 384 checkpoint values
(64 cells × 2 fields × 3 times) are asserted by the compiled Flow main()
against an independently generated double-precision reference. The
standard-library Python oracle independently reconstructs the full
coupled stencil, semigroup, positivity, boundary invariants and sensitivity
to diffusion and kill mutations. The model is genuinely nonlinear and
cross-coupled, unlike the previous two independent fields.

The Flow main additionally checks deterministic replay, semigroup composition,
zero-step identity, wrong boundary and negative initial concentration, invalid
ratios and reaction parameters, and output nonmutation on every rejection.
Explicit Euler diffusion ratios are bounded by 0.5, the state is finite and
bounded, and execution is capped at 1024 steps × 128 cells = 131072
cell-steps.

```sh
python3 -m unittest discover -s tests -p 'test_native_field_grayscott64_oracle.py' -v
flow run examples/native_field_grayscott64.flow
python3 scripts/verify_native.py --require-r
```

The existing production `/api/check/flow` and `/api/run/flow` smoke suite
and physical Chromium Monaco Run suite execute the same checked-in source;
malformed second-field syntax must return HTTP 422. No mocked interpreter is
used for these native gates. Oracle-only success does not establish native
compiler, HTTP or browser execution. This example does **not** claim general
cross-field PDE grammar, multidimensional fields, computed spatial plotting,
or RStudio parity. Verified in [six-job Linux/macOS PR CI #41093934670](https://github.com/godofecht/FlowStudio/actions/runs/41093934670): 1,143 JavaScript tests passed (12 skipped) and 380 Python tests passed (13 skipped) per source/transport platform; native Flow compiler, production HTTP, actual Ubuntu Chromium Monaco Run, and R/C FlowJIT passed on their applicable platforms. Independent macOS physical-browser acceptance and local native Flow/R/HTTP remain unexecuted.

## Native Flow computed spatial plot

The compiled Flow `main()` now prints a bounded, versioned
`FLOWSTUDIO_FIELD_V1 64 2` block containing the **actual 256-step U and V
states**, after all numerical and negative assertions pass. The native
localhost workbench reads this stdout through its existing real
`/api/run/flow` route. `web/native_field_plot.js` validates field names,
exact cell counts, finite bounded values, complete framing and resource
limits, then constructs SVG curves with DOM APIs; it never interprets the
output as HTML. Ordinary Flow stdout without a field block is unchanged.

The production HTTP acceptance compares all 128 transmitted cells with
the independent checked-in 256-step reference (tolerance accounts for
native text formatting). Chromium Monaco acceptance runs the same source
and checks that the plot is displayed and its values agree with the
reference. These gates require actual Flow execution; the Node parser
tests alone do not establish native plotting.
