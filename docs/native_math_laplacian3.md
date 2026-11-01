# Native Flow 2.0 anisotropic 3D Laplacian

The actual native mathematical source parser, typed postfix IR evaluator and
static SI dimension checker now execute the bounded scalar stencil

`laplacian3(center, left, right, down, up, back, front, dx, dy, dz)`.

This is opcode 87 with exactly ten eagerly evaluated scalar operands, not an
editor snippet or a general PDE AST. All seven field samples must share SI
dimensions; each positive, finite spacing must have dimensions of length.
The result has field units divided by length squared. Runtime rejects zero or
negative spacings, Boolean operands, mixed units, nonfinite/overflowing
arithmetic and malformed calls. Static inference checks types and dimensions
but does not claim to prove nonzero spacing.

The evaluator computes the anisotropic seven-point centered stencil:

```
(left - 2*center + right)/dx²
+ (down - 2*center + up)/dy²
+ (back - 2*center + front)/dz²
```

A normalized field scale reduces premature intermediate overflow. The
existing 1e30 numeric bound and ±32 SI exponent bound remain enforced.

`src/math_laplacian3_smoke.flow` runs 24 native parser, numerical,
negative and dimensional assertions. The exact-rational independent oracle in
`tests/test_laplacian3_oracle.py` manufactures three anisotropic quartic
polynomial fields, checks both grid resolutions and verifies the 4:1
second-order truncation-error ratio. The existing production
`tests/http_finite_difference_smoke.py` compiles and runs these cases
through `/api/check/flow` and `/api/run/flow`, including a deliberately
corrupted expected value that must return HTTP 422. Both Linux and macOS
native CI gates execute the checked-in Navier–Stokes and heat programs as well.

This does not implement arbitrary-rank tensors, symbolic gradients,
generalized PDE boundary conditions, fully native Navier–Stokes, unified
upstream Flow grammar, or computed multidimensional visualization.
