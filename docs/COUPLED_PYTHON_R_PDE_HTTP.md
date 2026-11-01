# Production Python → R → Python coupled PDE acceptance

`examples/coupled_interop_python.py` constructs two independent 32×32 periodic
fields using distinct Fourier amplitudes and means. The real FlowStudio Python
kernel returns the 2,048 finite initial values through `/api/run/python`.
The real persistent Rscript kernel receives them through `/api/run/r`, and
`examples/coupled_interop_r.R` performs 64 simultaneous explicit-midpoint
steps of a coupled reaction-diffusion system:

\[
\partial_t u = 0.12\Delta_h u + 0.05(v-u),\qquad
\partial_t v = 0.12\Delta_h v + 0.05(u-v).
\]

Here \(\Delta_h\) is the unscaled periodic five-point stencil on the 32×32
lattice and the step size is 0.1. The R code computes the stencil itself;
Python does not supply R's final values. R checks total mass and finiteness,
renders a real base-R heatmap and emits a bounded 2,048-value result frame.

The persistent Python kernel then checks **every** returned cell against a
separate analytical discrete Fourier solution, diagonalizing the sum and
difference species modes. Four separated single-cell corruptions and two
malformed frames must return HTTP 422. The R plot endpoint must return real
SVG or PDF graphics; both kernels must remain usable after the rejected
requests. The 131,072 species-cell-step ceiling, 128 KiB source budget,
finite-number validation, 15-second R process deadline and deterministic
initial state are explicit.

Run `python3 -m unittest tests/test_coupled_interop_oracle.py -v` for the
independent standard-library Python direct-stencil, semigroup, replay, seeded
conservation, negative-input and resource-bound checks. Run
`python3 scripts/verify_native.py --require-r` to build the real Flow router
and execute the production HTTP acceptance via `tests/http_smoke.py`.
Linux/macOS native CI is required before marking the HTTP execution verified.

This verifies a substantial cross-language numerical and plotting pipeline,
not compiler-generated multidimensional Flow `field` lowering, native
Navier–Stokes, or complete RStudio parity.
