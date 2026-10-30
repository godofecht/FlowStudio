# Native nonlinear spatial SIR evolution acceptance

`examples/native_spatial_sir2.flow` is a **real upstream Flow 2.0**
`flow SpatialSIR2` declaration, not Python simulation or generated mock.
It uses the compiler-generated `SpatialSIR2_step` RK4 integrator for six
coupled state variables (susceptible, infected, recovered in each of two
periodic spatial cells). Local nonlinear incidence is
`beta * susceptible * infected`; infected individuals recover at rate
`gamma`. Three independently adjustable spatial diffusivities use the
two-cell periodic finite-volume Laplacian `2 * (other - current)`.

The reference case starts at
`(0.98, 0.02, 0, 0.90, 0.05, 0.05)`, with
`beta=1.7`, `gamma=0.35`, `Ds=0.12`, `Di=0.08`, `Dr=0.05`,
and integrates to `t=1.75`. All six components are compared against an
independent Python RK4 reference computed with 32,768 and 65,536 steps,
not values produced by Flow. The expected reference is approximately

```text
S_left   0.7340843061018968     I_left   0.19151718293442213
R_left   0.06003023805422079    S_right  0.6341672913741969
I_right  0.2575878024884659     R_right  0.12261317904680538
```

Native acceptance asserts fourth-order refinement over 4, 8, 16, 32,
and 64 steps; conservation of total population 2; nonnegativity; decreasing
susceptibility and increasing recovered fractions; deterministic replay;
semigroup consistency; cell-exchange symmetry; and rate/time scaling.
Additional **independent exact solutions** validate the nonlinear logistic
limit with zero recovery/diffusion and exponential recovery with zero
infection/diffusion. Negative parameters, invalid populations, durations,
excessive work and coarse timesteps fail before integration. The budget is
8,192 steps, duration at most 20, bounded nonnegative rates, and a
conservative rate-step restriction.

## Reproduce

```sh
python3 -m unittest discover -s tests -p 'test_native_spatial_sir2_oracle.py' -v
flow run examples/native_spatial_sir2.flow
python3 scripts/verify_native.py --require-r
```

The unchanged Linux/macOS CI workflow runs the exact native Flow source.
The production HTTP acceptance calls `/api/check/flow` and
`/api/run/flow`, verifies the success marker, and submits a deliberately
malformed evolution equation for a real compiler rejection. Ubuntu Chromium
also loads the checked-in file into Monaco and clicks the actual Run control.
The Python oracle is an independent check, **not** proof of native execution.

This is a manually enumerated, two-cell reaction-diffusion system. It does
not implement general PDE declarations, dynamic spatial meshes, automatic
stencil lowering, native symbolic calculus or full RStudio parity.
