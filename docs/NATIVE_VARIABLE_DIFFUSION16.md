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

The production `tests/http_smoke.py` compiles and runs the checked-in Flow
source through real `/api/check/flow` and `/api/run/flow` endpoints,
independently checks every returned cell against the sparse operator, and
requires HTTP 422 for a deliberately broken numerical assertion and
malformed Flow source.

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
