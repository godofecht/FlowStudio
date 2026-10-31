# Cross-coupled native 32×32 tensor PDE acceptance

## Full directed Fourier-field acceptance (2026-10-31; CI pending)

The native Flow program now checks **all 2,048 directed U/V cells**, not
only the two species means, against an independent nonsymmetric 2×2 Fourier
matrix exponential at 32, 64 and 128 RK2 steps. The exact t=0.025
zero/plus/minus mode coefficients are U=(294.09906897477157,
1.2045742437862, 0.7763731765973004) and V=(10.900931025228495,
0.39074462095173346, -0.08888326676573649). The new Flow assertions
require the full-grid 128-step error below 0.00012, second-order refinement,
directed semigroup consistency and unchanged initial inputs. All assertions
run **before** the existing 2,048-cell symmetric heatmap frame is emitted,
so existing HTTP and Chromium acceptance continues to exercise the same
production Flow program. The checked-in Python oracle also tests exact
coefficient identity, directed semigroup composition and zero-rate
triangular exchange limits.

Independent local standard-library mode calculations gave maximum full-grid
errors of 0.00143712760843 (32 steps), 0.00035220933262 (64) and
0.00008718879974 (128). **Unexecuted at submission:** the checked-in
Python test file, native Flow compiler/HTTP/browser and Linux/macOS CI.
This remains array-based numerical evolution, not general compiler-backed
multidimensional field declarations or RStudio parity.

## Directed conservative exchange extension (2026-10-31; CI pending)

The same production-compiled Flow solver now accepts independent nonnegative
forward and reverse exchange rates. The cross-coupling is
`transfer = forward*U - reverse*V`, with `dU/dt -= transfer` and
`dV/dt += transfer`. Symmetric 0.35/0.35 preserves the previously qualified
2,048-cell output and browser heatmaps. A new 0.8/0.2 directed case checks
the analytic zero Fourier mode at t=0.025:
`mean(U)=294.0990689747715`, `mean(V)=10.900931025228488`,
with total 305 conserved. The stability guard now includes the sum of
both exchange rates; negative reverse rates fail closed.

The independent Python oracle evaluates all 2,048 directed species cells
against the exact nonsymmetric 2×2 matrix exponential at 32, 64 and 128
midpoint steps, and adds seeded orientation/conservation and deterministic
replay checks. An independent local standard-library calculation obtained
maximum analytical errors 0.00143713, 0.000352209 and 0.0000871888,
respectively. **Unexecuted:** exact checked-in Python suite, production
Flow compiler/HTTP/browser acceptance for this revision and Linux/macOS
CI. The previously qualified symmetric baseline does not qualify these
new directed assertions.


`examples/native_coupled_tensor32.flow` is a real Flow 2.0 program, not
a Python interpretation or a precomputed browser visualization. It integrates
two 1,024-cell periodic fields simultaneously with explicit midpoint RK2:

```text
∂t U = 0.012 ∂xx U + 0.008 ∂xy U + 0.018 ∂yy U + 0.35 (V-U)
∂t V = 0.008 ∂xx V - 0.004 ∂xy V + 0.010 ∂yy V + 0.35 (U-V)
```

Both species have different positive-definite diffusion tensors. The mixed
derivative uses four periodic corner neighbors and the same simultaneous
midpoint state supplies the interspecies exchange. The initial fields are
`U=300+7 cos(π(x+y)/2)+3 cos(π(x-y)/2)` and
`V=5+0.8 cos(π(x+y)/2)-0.3 cos(π(x-y)/2)`.
Quarter-turn modes use exact integer phase values to avoid relying on native
trigonometric lowering. Spatial spacing is 1/32.

The two diagonal modes have distinct discrete decay rates: U has 69.632
and 53.248; V has 32.768 and 40.96. Each mode's exact time evolution is
the **matrix exponential** of the 2×2 operator with diagonal entries
`-decayU-0.35`, `-decayV-0.35` and off-diagonal entries `0.35`.
At t=0.025, the exact baseline is (297.4412047605983,
7.55879523940171), plus-mode amplitudes are
(1.2190283628708836, 0.36705079343263286), and minus-mode amplitudes
are (0.7848050213369989, -0.09876499673375012).

The Flow program checks all 2,048 evolved cells against those analytical
references at 32, 64 and 128 steps, second-order refinement, conserved
total mass 305, real species-to-species mass transfer, semigroup composition,
deterministic replay, uncoupled counterfactual, zero time, invalid diffusion
tensor, invalid exchange, invalid time, stability rejection, input nonmutation
and a 400,000 species-cell-step ceiling. The frame is emitted **only after**
those assertions pass, using `FLOWSTUDIO_GRID_V1 32 32 2` and the actual
RK2 states U/V. The workbench renders 2,048 SVG cells with independent
per-field color scales.

`tests/test_native_coupled_tensor32_oracle.py` independently implements
the full two-dimensional stencil, midpoint solver, Fourier matrix
exponential, deterministic seeded translation and conservation tests.
`tests/http_smoke.py` submits the checked-in Flow source to production
`/api/check/flow` and `/api/run/flow`, verifies every transmitted
cell and tests malformed source and a deliberately corrupted numerical
assertion. `tests/native_math_plot_ui.mjs` clicks the actual Monaco Run
control in Chromium and checks both heatmaps and 14 analytical samples.

```sh
python3 -m unittest discover -s tests -p 'test_native_coupled_tensor32_oracle.py' -v
flow run examples/native_coupled_tensor32.flow
python3 scripts/verify_native.py --require-r
```

**Qualification:** independent local direct-stencil numerical cross-check
completed: maximum analytical error 0.00142276 (32 steps), 0.000348733
(64 steps), 0.0000863335 (128 steps); derivative residuals below 1.2e-13.
[Exact-head PR CI #41152594762](https://github.com/godofecht/FlowStudio/actions/runs/41152594762)
passed all six Linux/macOS jobs: each source platform passed 1,156
JavaScript tests (12 skipped) and 392 Python tests (13 skipped); both
production native Flow/HTTP suites passed, including all 2,048 cell checks,
malformed source and corrupted numerical assertion rejection; Ubuntu Chromium
executed the real Monaco Run and verified both SVG fields; both native R/C
FlowJIT jobs passed. Local Flow/R and independent macOS physical-browser
acceptance remain unexecuted. Post-merge main CI remains unverified.

This is genuinely coupled *array-based* 2D native Flow numerical execution,
not general multidimensional `field` grammar, automatic PDE lowering,
solver selection, or full RStudio parity.
