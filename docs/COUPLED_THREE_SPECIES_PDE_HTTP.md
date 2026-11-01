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

## Physical Chromium notebook acceptance (exact-head CI verified)

`tests/native_three_species_browser.mjs` is invoked by the existing
`tests/native_ui.mjs` production Playwright path. Native Python HTTP creates
the seed-9137 vectors and later checks the 3,072 R-computed cells. Chromium
itself clicks Run all cells on one native Flow and four persistent native R
cells, verifies the decoded R PNG, downloads and reimports the actual
`.fsnb` snapshot without execution, and confirms that a non-finite R input
stops the notebook before a later cell mutates persistent R state.

Run with the existing real-server qualification:

```sh
python3 scripts/verify_native.py --require-r
```

The existing six-cell Python/R/Flow HTTP controller test is distinct from
this five-cell physical browser case. This addition is not a browser Python
kernel acceptance. [Exact-head CI #41270555580](https://github.com/godofecht/FlowStudio/actions/runs/41270555580)
passed all four Linux/macOS jobs; the Ubuntu native job logged successful
physical Chromium three-species execution, all 3,072-cell Python oracle
assertions, R PNG decoding, failure isolation and .fsnb restoration.
Independent macOS physical-browser interaction and local native Flow/R
remain unexecuted.


## Two-stage native R checkpoint/restart acceptance

The same seed-9137 three-species 32×32 anisotropic system is now evolved
through two **separate** persistent native R HTTP requests, each running 24
explicit-midpoint steps from `examples/coupled_three_species_restart_r.R`.
The first request commits an R matrix checkpoint and phase 1; the second
resumes that checkpoint and commits phase 2. Every one of the 3,072 values
at both checkpoints is independently checked against the production Python
direct-stencil implementation at 24 and 48 steps. The final restarted
solution must agree with the separate uninterrupted 48-step R integration.

The real HTTP acceptance rejects a NaN-corrupted checkpoint (422), a
25-step chunk exceeding the 147,456 species-cell-step ceiling (422), and
a third chunk after completion (422). Rejection must preserve the phase,
and restoring the saved checkpoint must allow recovery. A fresh two-chunk
replay must reproduce both complete output frames exactly. Every R source
is below 64 KiB, every Python oracle request below 128 KiB, and each R
result frame below 100 KiB. No mocked R or Python runtimes are involved.

This scenario is wired into `tests/coupled_three_species_http.py`, invoked
by `python3 scripts/verify_native.py --require-r`. Local native R and
independent physical Chromium execution of the checkpoint scenario are
**unexecuted** until separately qualified. It does not implement
compiler-generated multidimensional Flow `field` lowering.
