# Native 64-cell affine Dirichlet field acceptance

This example exercises **upstream Flow 2.0** `field`, `evolves as laplacian`, and
`boundary` declarations with **unequal, nonzero** fixed endpoints (1 and 2).
The compiler-generated `U_field_step` invokes the upstream standard-library
Euler stencil. Unlike the preceding 32-cell zero-boundary test, the steady
state is the nonconstant affine profile `1 + i/63`.

The initial condition adds two independent Dirichlet eigenmodes, with amplitudes
0.7 and -0.25 and mode indices 1 and 4. All 64 cells are checked after 16,
64, and 128 steps against 17-digit semidiscrete analytical references. The
independent Python oracle reconstructs the references and separately executes
the finite-difference stencil. Native assertions additionally check residual
energy decay, positivity, affine equilibrium, deterministic replay, semigroup
composition, zero-step and zero-ratio identities, stability-limit acceptance,
invalid boundary values, malformed input, output nonmutation on rejection,
and an explicit 4096-step / 262144-cell-step cap.

```sh
flow run examples/native_field_affine64.flow
python3 -m unittest discover -s tests -p 'test_native_field_affine64_oracle.py' -v
python3 scripts/verify_native.py
```

The production `/api/check/flow` and `/api/run/flow` acceptance and real
Chromium Monaco Run acceptance must execute the same checked-in source. These
checks are not substituted by the Python oracle. General coupled or
multidimensional PDE declarations, computed spatial plots, remote-session
isolation and RStudio parity remain incomplete.
