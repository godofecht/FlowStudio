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

The native program also checks **every one of 64 intermediate steps** for
centered two-species spatial-energy contraction, combined mass conservation
and the global maximum principle. A versioned
`FLOWSTUDIO_VOLUME_ENERGY_V1` frame emits 64 computed energy values, and
`FLOWSTUDIO_VOLUME_FIELDS_V1` emits the complete 1,024-value 3D state.
Production HTTP compares every voxel against the independent Fourier
oracle and every intermediate energy against independently reconstructed
U/V means. Deliberately reversing the native energy invariant must compile
but fail execution with HTTP 422. Physical Ubuntu Chromium captures the
actual Monaco-triggered HTTP response and independently verifies all 1,024
voxels and all 64 energy samples, in addition to the 128 SVG slice cells.
The 64-step trace does not change the 262,144 species-voxel-step ceiling
for an individual integration.

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


## Seeded non-Fourier 3D qualification

The native Flow program also constructs two asymmetric seed-9137 volumes
from a bounded integer residue depending on all three coordinates. This is
not a Fourier eigenmode. It evolves both species for 64 steps with unequal
directional diffusivities and conservative exchange. Native assertions
cover 32+32 restart, replay, conservation, all-step centered spatial-energy
contraction, global maximum principle, coefficient mutation, and a bounded
256-step maximum (262,144 species-voxel updates).

The separate `FLOWSTUDIO_VOLUME_SEEDED_V1` frame exposes all 1,024
computed values, and `FLOWSTUDIO_VOLUME_SEEDED_ENERGY_V1` exposes
64 post-update energies. `tests/test_native_coupled_volume8_oracle.py`
independently assembles sparse Markov transition rows rather than reusing
the native stencil or Fourier reference. The production `/api/check/flow`
and `/api/run/flow` acceptance compares the complete native output to
that oracle and requires HTTP 422 for deliberately inverted seeded-energy
assertions. Physical Ubuntu Chromium checks the same complete output from
its actual Monaco-triggered HTTP request using separately assembled
JavaScript sparse rows.

Run the standard-library oracle with
`python -m unittest discover -s tests -p 'test_native_coupled_volume8_oracle.py'`.
Run the native example with `flow run examples/native_coupled_volume8.flow`
in an environment with the pinned production Flow toolchain. CI qualification
and independent macOS physical-browser execution must be reported separately.
This remains array-backed PDE execution, not generalized compiler-generated
multidimensional `field` lowering or full RStudio parity.

## Exact periodic impulse and stability-edge acceptance

The native 3D solver now checks the closed-form one-step Green function for
an impulse at the (0,0,0) corner with Courant ratio 0.5 and unit diffusion
along each axis separately. Exactly two voxels at periodic neighbors must
contain 0.5, and the other 1,022 species-voxels must be zero. The six
expected neighbor coordinates are x=(1,7), y=(8,56), z=(64,448) in the
native flat index. A tiny excess coefficient sum (1.01 at ratio 0.5)
must reject without modifying the input. Zero-diffusion identity, exact
two-step 0.25 interspecies exchange (U=0.625, V=0.375 at the impulse),
and constant but unequal species fixed points are also checked in the
production Flow main. The independent Python test reconstructs the exact
Green functions and compares both direct and sparse operators; these
checks add no unbounded loops or new output frames.

These assertions run as part of the existing native Flow/HTTP/Chromium
acceptance because they are embedded in the same production executable.
Local Python tests alone do not establish native Flow execution; consult
the exact-head Linux/macOS CI result before claiming that acceptance passed.
