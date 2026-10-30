# Native compiler-generated 32-cell field heat acceptance

This example uses upstream Flow 2.0 `field`, `evolves as laplacian` and
`boundary` declarations, rather than manually enumerating each spatial state.
The compiler-generated `T_field_step` invokes the actual standard-library
Dirichlet Euler stencil. A bounded wrapper validates finite input, zero
Dirichlet boundaries, the Euler stability ratio 0 ≤ r ≤ 0.5 and at most
4096 timesteps.

The 32-cell initial condition combines discrete sine modes 1 and 3 with
amplitudes 2.0 and 0.3. Each mode decays by its independent discrete Euler
eigenvalue `1 - 4r sin²(kπ/(2(N-1)))` per step. Every cell is checked after
16 and 64 steps against precomputed 17-digit analytical references. Native
assertions additionally test energy decay, positivity, semigroup composition,
deterministic replay, zero dynamics, source mutation and invalid parameters.

```sh
flow run examples/native_field_heat1d.flow
python3 -m unittest discover -s tests -p 'test_native_field_heat1d_oracle.py' -v
python3 scripts/verify_native.py
```

The Python oracle independently recomputes the 32 reference values and
runs a separate direct-stencil Euler implementation. It does **not** run the
Flow compiler; native Flow execution is exercised through the production
`/api/check/flow`, `/api/run/flow` and real Chromium Monaco Run paths
in the existing Linux/macOS CI. These must pass before any success claim.

This is a genuine upstream one-dimensional field/boundary lowering path,
not general coupled multidimensional PDE grammar, arbitrary boundary
conditions, or RStudio parity.
