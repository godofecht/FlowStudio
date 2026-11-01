# Native Flow heterogeneous 2D conservative diffusion

`examples/native_variable_diffusion16.flow` executes a real 16×16 periodic
finite-volume diffusion equation through the production Flow 2.0 compiler:

`u[t+1,i] = u[t,i] + 0.20 Σ_j 2 k[i] k[j] / (k[i]+k[j]) (u[t,j]-u[t,i])`.

Each cell has four periodic neighbors. The discontinuous conductivity is
0.25 or 0.75 across the vertical interface, with an additional 0.05 in the
upper half. Face coefficients are harmonic means, so opposite cells share
exactly the same interface flux and the total mass is conserved.

The native program checks 48-step conservation, positivity, 24+24 semigroup
consistency, exact deterministic replay, zero-step identity, a changed
interface coefficient, invalid conductivity, invalid ratios, nonmutation
on rejection and a 32,768-cell-step budget. It emits the actual computed
256-cell grid as `FLOWSTUDIO_GRID_V1 16 16 1`.

`tests/test_native_variable_diffusion_oracle.py` compares a direct
finite-volume stencil with an independently assembled sparse Markov
transition operator at 0, 8, 24 and 48 steps. A deterministic seed 20261101
also exercises arbitrary non-Fourier data, mass conservation and
coefficient-axis transposition. Negative tests reject malformed fields,
non-finite values, unstable ratios and out-of-budget steps.

The native main also evolves a second 256-cell, non-Fourier field generated
by deterministic integer residue seed **9137**. Its 48-step solution,
24+24 restart, mass conservation, positivity, coefficient mutation and
negative-input nonmutation are checked by native Flow. A distinct
`FLOWSTUDIO_SEEDED_GRID_V1` output frame allows real production HTTP
to compare **all 256 additional values** with the independent sparse
Markov oracle, and deliberately corrupted seeded conservation must return
HTTP 422. The original `FLOWSTUDIO_GRID_V1` frame remains unchanged
for the existing physical Chromium heatmap.

## Stepwise thermodynamic and fixed-point acceptance

The native Flow solver now independently checks both the Fourier and seed-9137
fields **after every one of the 48 updates**, not merely at the final
checkpoint. Its variance about the current mean must never increase
(tolerance 1e-8), and every intermediate cell must remain within the
initial global minimum/maximum (tolerance 1e-9). Final variance must
strictly decrease. Constant 23.75 fields and zero-timestep-ratio seeded
fields are exact fixed points. The original 32,768 cell-step limit per
integration call and 128 KiB HTTP source cap remain enforced.

Two additional standard-library Python tests independently assemble the
sparse Markov transition matrix, compare every timestep against the
separate direct finite-volume stencil, check both invariants, and prove
the energy check discriminates a deliberately sign-reversed
anti-diffusion step even though it still conserves mass.

**Qualification pending:** exact-head Linux/macOS native compiler,
production HTTP, Ubuntu Chromium and post-merge CI. The Python oracle
can run locally without the native compiler; that alone is not
evidence that the Flow program executes.

The production `tests/http_smoke.py` compiles and runs the checked-in Flow
source through real `/api/check/flow` and `/api/run/flow` endpoints,
independently checks every returned cell against the sparse operator, and
requires HTTP 422 for a deliberately broken numerical assertion and
malformed Flow source. The existing physical Chromium
`tests/native_math_plot_ui.mjs` path also runs the real Monaco editor,
production Flow HTTP and SVG renderer, independently checking all 256
rendered heatmap cells against a separate sparse Markov operator.

Reproduce locally where the real compiler is installed:

```sh
python3 -m unittest tests/test_native_variable_diffusion_oracle.py -v
python3 scripts/verify_native.py --require-r
```

The second command runs the actual Flow-owned HTTP server and existing
native/browser acceptance, not a simulation. CI status is only established
after exact-head Linux/macOS jobs complete. This example is array-backed
variable-coefficient PDE execution, **not** generalized compiler-generated
multidimensional `field` lowering or RStudio parity.
