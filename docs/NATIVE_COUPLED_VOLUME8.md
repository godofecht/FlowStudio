# Native coupled 8×8×8 volume acceptance

`examples/native_coupled_volume8.flow` executes two **512-voxel**
anisotropic periodic diffusion equations with simultaneous conservative
interspecies exchange using the pinned production Flow 2.0 compiler. The
native code evolves both 3D volumes directly; no Python interpreter, mock,
precomputed field or two-dimensional surrogate performs the computation.

Each species has a different diagonal diffusion tensor:
`U=(0.10,0.08,0.06)`, `V=(0.04,0.07,0.05)`, with Euler ratio `0.20`
and exchange `0.03`. The initial 3D state contains three independent
quarter-wave modes `cos(pi*(x+y)/2)`, `cos(pi*(y+z)/2)` and
`cos(pi*(x+y+z)/2)`, each with different species amplitudes, plus
different species means. Their discrete directional Laplacian eigenvalues
are exactly `-2` on each active axis. The native main compares **all
1,024 species-voxels** against separately propagated six Fourier
amplitudes and means at **8, 32 and 64 steps** (3,072 numerical checks).

`tests/test_native_coupled_volume8_oracle.py` independently reconstructs
both the full three-dimensional six-neighbor stencil and the 2×2
mode-coupling matrix evolution, including seeded arbitrary 3D initial
conditions, exact replay, semigroup consistency, conservation, parameter
sensitivity, invalid inputs and a strict **256 steps × 1,024 species-voxels
= 262,144 species-voxel-step** ceiling.

The real `/api/check/flow` and `/api/run/flow` endpoints compile and run
the same source in `tests/http_smoke.py`, verify the 128 numeric values
of the emitted `FLOWSTUDIO_GRID_V1 8 8 2` z=0 slices against the
independent Fourier reference, and reject a corrupted native assertion
and malformed source with HTTP 422. The Ubuntu physical Chromium acceptance
in `tests/native_math_plot_ui.mjs` clicks Monaco's Run button and
checks every one of the 128 actual SVG grid-cell values against the
independently evolved reference. The 8×8 heatmaps are **computed slices of
3D volumes**, not claims of general 3D visualization.

Reproduce with:

```sh
python3 -m unittest discover -s tests -p 'test_native_coupled_volume8_oracle.py' -v
flow run examples/native_coupled_volume8.flow
python3 scripts/verify_native.py --require-r
# In the running native-server Chromium acceptance:
node tests/native_math_plot_ui.mjs
```

This is native, array-backed 3D numerical execution, **not** a
compiler-generated three-dimensional `field` DSL, native Navier–Stokes
or complete RStudio parity. Qualification must distinguish independent
local numerical checks, native compilation, production HTTP, physical
browser execution, and Linux/macOS CI.
