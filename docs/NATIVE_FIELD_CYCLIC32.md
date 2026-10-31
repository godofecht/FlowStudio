# Native three-field directed cyclic PDE acceptance

`examples/native_field_cyclic32.flow` is a single production Flow 2.0
program with **three** upstream `field` / `laplacian` / Dirichlet
declarations. The pinned compiler generates the spatial operators
`U_field_step`, `V_field_step` and `W_field_step`; an explicit,
simultaneous, directed cyclic exchange couples their newly diffused values.

The 32-cell domain has fixed zero endpoints. Initial amplitudes are
`(1, 2, 4) sin(pi*i/31)`; the dimensionless Euler ratio is `0.2`
and the directed exchange fraction is `0.08`. For each time step, the
discrete sine eigenvalue is `mu = 1 - 4*r*sin(pi/62)^2`, and the
three amplitudes evolve as `a[n+1] = mu*M*a[n]`, with
`M = [[.92,.08,0],[0,.92,.08],[.08,0,.92]]`.
This is **not** a symmetric exchange matrix. The discrete Fourier/matrix
oracle is independent of the direct three-field finite-difference stencil.

The native Flow main checks all **288** values at 16, 64 and 128 steps,
energy decay, positivity, fixed endpoints, semigroup consistency, exact
deterministic replay, zero-step identity, sensitivity to exchange, invalid
diffusion/exchange bounds, malformed initial conditions and output nonmutation
after rejection. The maximum budget is 1,024 steps × 96 species-cells =
98,304 cell-steps. The executable emits `FLOWSTUDIO_FIELD_V1 32 3`
containing its **computed** 128-step values for three actual browser curves.

`tests/test_native_field_cyclic32_oracle.py` independently checks every
checkpoint against both a direct finite-difference stencil and the
discrete Fourier/matrix-power reference. `tests/http_smoke.py` compiles
and runs the exact checked-in Flow program through the real
`/api/check/flow` and `/api/run/flow` routes, verifies all 96 transmitted
plot values, and requires HTTP 422 for malformed third-field syntax and a
corrupted numerical assertion. `tests/native_math_plot_ui.mjs` uses
real Chromium, Monaco's Run button and the native server to verify the
three computed SVG paths.

Local independent standard-library numerical reproduction: maximum
direct-stencil versus spectral error **9.33e-15** across the three
checkpoints. Native Flow, HTTP, physical Chromium and Linux/macOS CI
qualification must be reported separately; this calculation does not
establish that those gates passed.

This advances compiler-generated **multiple 1D fields with explicit
coupling**. It does not implement general multidimensional `field`
operators, coefficient-aware coupled PDE grammar, native Navier–Stokes,
or complete RStudio parity. Upstream Flow PR #1637 remains a separate
compiler qualification blocker.

To reproduce with the pinned Flow 2.0 toolchain:

```sh
python3 -m unittest discover -s tests -p 'test_native_field_cyclic32_oracle.py' -v
flow run examples/native_field_cyclic32.flow
python3 scripts/verify_native.py --require-r
```

The final command exercises real production HTTP; the repository's native
CI also invokes the Chromium suite. No hosted CI configuration changes
are required.
