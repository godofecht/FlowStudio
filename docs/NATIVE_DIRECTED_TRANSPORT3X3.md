# Native 3×3 directed advection–diffusion acceptance

The checked-in `examples/native_evolution_heat3x3.flow` contains **two**
independent upstream Flow 2.0 `flow` declarations. The second,
`DirectedTransport3x3`, is a nine-state periodic continuous-time Markov
generator with unequal directed x/y transport and symmetric diffusion:

```text
d u[x,y] / dt =
    ax * (u[x-1,y] - u[x,y]) + ay * (u[x,y-1] - u[x,y])
  + Dx * (u[x-1,y] + u[x+1,y] - 2*u[x,y])
  + Dy * (u[x,y-1] + u[x,y+1] - 2*u[x,y])
```

All indices are modulo three; the initial field is a unit impulse at (0,0).
The rates are ax=0.7, ay=0.35, Dx=0.12, Dy=0.08, and t=1.3. The native
compiler-generated `DirectedTransport3x3_step` advances the system with
RK4. The exact **semidiscrete** solution is the product of the two 3-cycle
transition kernels

```text
P(j,t;a,d) = [1 + 2 exp(-(3a/2+3d)t)
                 cos(sqrt(3)at/2 - 2*pi*j/3)] / 3
u[x,y](t) = P(x,t;ax,Dx) * P(y,t;ay,Dy)
```

This exercises genuinely complex conjugate Fourier modes and directional
asymmetry, not just real-valued heat eigenmodes. Native assertions compare
all nine cells at 4/8/16/64 steps, require fourth-order refinement, and
verify mass conservation, positivity, deterministic replay, semigroup
composition, periodic translation, time/rate scaling, equilibrium,
zero-duration/frozen dynamics and rejection of invalid parameters or
excessive work. Maximum 2,048 steps; duration and rates are bounded,
and a conservative step-size restriction is checked before integration.

## Reproduction

```sh
python3 -m unittest discover -s tests -p 'test_native_directed_transport3x3_oracle.py' -v
flow run examples/native_evolution_heat3x3.flow
python3 scripts/verify_native.py --require-r
```

The independent standard-library Python oracle reconstructs the generator
and a separate RK4 integrator. It is **not** a substitute for the Flow
compiler. Existing CI runs the same checked-in Flow source via native
`flow run`, production `/api/check/flow` and `/api/run/flow`, and the
Ubuntu Chromium Monaco Run button; the existing CI workflow is unchanged.

Independent oracle numerical maximum errors for 4, 8, 16, 32, 64 RK4
steps are approximately 3.75005e-4, 1.74754e-5, 9.40765e-7,
5.45404e-8 and 3.28262e-9, respectively.

**Scope:** a manually enumerated 3×3 spatial operator in upstream Flow,
not a general PDE grammar, unbounded grid, arbitrary tensor compiler,
or full RStudio parity. Local native Flow/R/HTTP and independent macOS
physical-browser execution were unavailable during authoring. See issue #198.
