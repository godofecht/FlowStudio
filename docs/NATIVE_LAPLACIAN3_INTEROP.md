# Native 3D Laplacian cross-runtime qualification

The production Flow 2.0 parser/evaluator implements the bounded scalar
`laplacian3(center, left, right, down, up, back, front, dx, dy, dz)`
seven-point stencil with SI-aware positive spatial spacings. This is not
general compiler-generated multidimensional `field` lowering.

The independent manufactured-solution generator in
`tests/test_laplacian3_oracle.py` supplies three anisotropic polynomial
fields, each at coarse and half-resolution grids. Their exact curvature
is respectively 0, 18 and 6 K/m². All three have nonzero truncation error
and exact 4:1 coarse/fine error ratios. The native Flow source is compiled
and run through real `/api/check/flow` and `/api/run/flow` endpoints,
including a sabotaged numerical assertion required to return HTTP 422.

The seed-20261102 LCG adds 12 independent 3D fields and 12 axis-swapped
metamorphic equivalents. The native Flow compiler executes these 24 cases
in three bounded eight-case HTTP batches and rejects a deliberately
corrupted seeded expectation with HTTP 422.

`tests/http_laplacian3_interop.py` independently parses all 30 samples
and checks their values as rational numbers. The production persistent
base-R HTTP kernel evaluates the same samples using a separate numerical
seven-point expression, emits 30 bounded frames and checks expected
values. The persistent CPython HTTP kernel reconstructs exact rational
results, checks the R frames, refinement ratios, and rejects deliberate
numerical corruption and truncation with HTTP 422. Both kernels must
recover and preserve the R session counter. Source bodies are bounded
by 128 KiB and R result frames by 24 KiB.

Reproduce from the repository root with the pinned native compiler,
a working base-R installation and a running local FlowStudio server:

```sh
python3 -m unittest discover -s tests -p 'test_laplacian3_interop.py' -v
python3 -m unittest discover -s tests -p 'test_laplacian3_oracle.py' -v
python3 scripts/verify_native.py --require-r
```

This gate does not claim physical-browser coverage on macOS, symbolic
differentiation, arbitrary tensor fields, heterogeneous PDE coefficient
lowering, general boundary conditions or complete RStudio parity.
See `docs/PARITY.md` and issue #198 for outstanding work.
