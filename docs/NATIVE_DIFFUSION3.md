# Native heterogeneous 3D diffusion: compiler and HTTP acceptance

The production Flow 2.0 mathematical source compiler now parses, typechecks
and executes the bounded scalar finite-volume face-flux operator:

```flow
diffusion3(center, left, right, down, up, back, front,
           kleft, kright, kdown, kup, kback, kfront, dx, dy, dz)
```

The seven field samples share a physical dimension (for example K). The six
nonnegative face diffusivities must have SI dimension m²/s, and the three
strictly positive spacings must have dimension m. The output dimension is
the field dimension divided by time (K/s for temperature).

For a diffusivity of 2 m²/s, write `(2*1m²/1s)` in the current native
mathematical expression dialect. Its postfix `²` squares the preceding
quantity, so `2m²` evaluates as `(2m)²` (4 m²), not 2 m². The fixtures
explicitly multiply a scalar by `1m²` to preserve intended coefficients.

Each axis uses the conservative flux difference
`(k_plus*(u_plus-u_center)-k_minus*(u_center-u_minus))/h²`.
Equal face coefficients on adjacent cells produce opposing fluxes, so the
operator can be assembled into a conservative grid evolution. Uniform
coefficients reduce to `k*laplacian3(...)`; heterogeneous coefficients
must not be approximated by `k_center*laplacian3(...)`.

The checked-in seed-20261102 exact-rational oracle creates 12 heterogeneous
stencils and 12 axis-swapped equivalents. The native Flow compiler and actual
`/api/check/flow` and `/api/run/flow` endpoints execute all 24 cases in
six four-case batches, each bounded to 128 KiB source. A corrupted numerical
expectation must compile but fail with HTTP 422. The existing native CLI
smoke adds analytical constant/heterogeneous cases, static SI inference,
parser source offsets, malformed arity, invalid coefficient dimensions,
negative coefficients, zero spacings, predicate rejection and equations.

The persistent base-R HTTP kernel independently evaluates all 24 face-flux
stencils. A separate persistent CPython HTTP kernel reconstructs exact
`Fraction` values from bounded R frames, verifies axis invariance, and
requires HTTP 422 for numerical corruption and truncated frames. Both
interpreters must recover after deliberate failures. Source and response
limits are 128 KiB and 24 KiB respectively.

Reproduce from the repository root with the pinned native Flow compiler,
working R installation and production localhost HTTP server:

```sh
python3 -m unittest discover -s tests -p 'test_diffusion3_oracle.py' -v
python3 scripts/verify_native.py --require-r
```

This is real native Flow scalar lowering, **not** general compiler-generated
multidimensional `field` declarations, automatic boundary conditions,
symbolic spatial derivatives, variable-mesh finite volumes or complete
RStudio parity. The outstanding generalization remains tracked in
`docs/PARITY.md` and issue #198.
