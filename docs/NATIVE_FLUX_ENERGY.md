# Heterogeneous periodic 3D flux energy qualification

Seed **20261102** fixes a 3×3×3 periodic Cartesian grid, 81 positive independently
seeded shared-face conductances, anisotropic spacings (1/2, 3/4, 5/4), and 27
initial rational cell values. The independent Python `Fraction` oracle constructs
shared face fluxes `k (u_next - u) / h`, and computes
`fluxdiv3(left, right, down, up, back, front, dx, dy, dz)` at every cell.

For each of nine exact states (initial plus eight forward-Euler steps, dt=1/64),
the oracle requires zero global divergence and the exact discrete
integration-by-parts identity:

```text
sum_cells(u * div(F)) == -sum_shared_faces(k * (u_next - u)^2 / h^2)
```

Every step must preserve total mass, strictly reduce quadratic energy, stay
inside the original extrema, and replay deterministically. These checks do
not depend on the Flow compiler or on a Python floating-point stencil.

The real FlowStudio native compiler and production HTTP check/run endpoints
must independently execute 24 selected `fluxdiv3` expressions: twelve
spatially distributed cells at step zero and the same twelve after eight
steps. Each three-case request is bounded to 128 KiB. A deliberately
corrupted expected value must compile successfully but return HTTP 422 on
execution. The tests use the production Flow source bundle and do not
substitute a mock compiler, HTTP router or runtime.

Reproduce the independent oracle:

```sh
python3 -m unittest discover -s tests -p 'test_flux_energy.py' -v
```

With the production native Flow server available on loopback, execute:

```sh
python3 tests/http_flux_energy_smoke.py
```

The complete native build and live HTTP qualification is:

```sh
python3 scripts/verify_native.py --require-r
```

CI runs this suite in both Ubuntu 24.04 and macOS 15 native jobs. It
supplements, rather than replaces, compiler-generated field lowering,
boundary-condition tests, multidimensional visualization, physical-browser
interaction and the remaining RStudio parity matrix. A green Python oracle
alone is not proof of native Flow execution.
