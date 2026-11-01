# Three-species anisotropic PDE through production Python/R HTTP

The checked-in `examples/coupled_three_species_python.py` generates three
distinct 32×32 fields from deterministic seed 9137. FlowStudio's real
persistent Python kernel sends all 3,072 initial cells to the persistent R
kernel, which executes `examples/coupled_three_species_r.R` with 48
explicit-midpoint steps and an actual base-R heatmap.

For species `s = 0,1,2`, the computed evolution is

`d u_s/dt = D_x[s] Δ_x u_s + D_y[s] Δ_y u_s + 0.07 (u_(s-1 mod 3) - u_s)`.

The x/y diffusion coefficients are `(0.08, 0.13, 0.19)` and
`(0.17, 0.09, 0.05)`; the time step is `0.1`. The exchange is
non-reversible and conserves total mass across the three species.
The anisotropic coefficients make accidental x/y transposition observable:
R explicitly reads Python row-major vectors using `byrow = TRUE` and
returns `as.vector(t(field))`.

The production `tests/coupled_three_species_http.py` acceptance uses
real `/api/run/python`, `/api/run/r`, and `/api/plot/r` requests.
All 3,072 computed R values are checked by a separate Python
finite-difference midpoint implementation. Three single-cell corruptions
and two malformed frames must produce HTTP 422, after which both persistent
kernels must remain usable. The R graphic must be actual SVG or PDF.
The 147,456 species-cell-step ceiling, 128 KiB source/transport limit,
finite-number validation and deterministic seed are explicit.

`tests/test_coupled_three_species_oracle.py` independently diagonalizes
the periodic spatial Fourier modes and evolves their three coupled
amplitudes with a 3×3 matrix recurrence at 0, 24 and 48 steps. It checks
all 3,072 values against the direct stencil, plus seeded replay,
semigroup consistency, conservation, x/y orientation, mutation rejection,
typed-invalid inputs and the resource ceiling.

Reproduce with:

```sh
python3 -m unittest tests/test_coupled_three_species_oracle.py -v
python3 scripts/verify_native.py --require-r
```

The second command compiles the real Flow-owned router and exercises the
real HTTP runtime, rather than mocked kernels. Linux/macOS CI qualification
and physical-browser checks must be reported separately. This is a
cross-language numerical acceptance test, **not** generalized native
multidimensional Flow `field` lowering or complete RStudio parity.

## Real mixed-language notebook acceptance

The same checked-in numerical programs also run as **six executable cells**
through the production notebook controller in
`tests/native_mixed_notebook_http.cjs` and
`tests/native_three_species_notebook_http.cjs`. The sequence is native Flow,
persistent Python, three separate R input-transfer cells and an R midpoint
integration/plot cell. The notebook does not pretend Python and R share a
namespace: all 3,072 seed values are explicitly serialized into bounded R
assignments. The 3,072 returned R values are checked by the persistent
Python stencil, with a single-cell mutation required to return HTTP 422.
Real R SVG/PDF graphics, complete `.fsnb` output restoration and recovery
of both persistent kernels are asserted. Each cell remains within the 64 KiB
notebook source limit, and the verifier payload stays below 128 KiB.

This path is invoked by the existing `tests/http_smoke.py` under
`python3 scripts/verify_native.py --require-r`; it requires a running
production FlowStudio server and real Flow, Python and R runtimes.
The new six-cell scenario is **not** separately exercised through physical
Chromium. Its Linux/macOS CI status must be established on the exact commit
before treating it as verified.
