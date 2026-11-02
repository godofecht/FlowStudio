# Native Flow 2D-to-3D conservative diffusion reduction

This regression checks the production Flow 2.0 scalar diffusion operators,
not a symbolic or multidimensional `field` lowering implementation.

For each of the nine seed-20261102 periodic 2D cells, the exact-rational
oracle independently evaluates `diffusion2` and two different embeddings
into `diffusion3`. In the first embedding, both z-neighbor values equal
the center while the z-face diffusivities are unequal and nonzero. In the
second, the z-neighbor values differ from the center while both z-face
diffusivities are zero. Both must give exactly the 2D derivative, with
identical x/y face values, diffusivities and spacings. This distinguishes
zero-gradient from zero-coefficient boundary behavior.

The actual production Flow HTTP compiler/runtime must compile and execute
all **27 expressions** (nine 2D and eighteen 3D) in nine separate bounded
source requests. Each request checks the exact-rational expected value, not
only equality between two potentially incorrect implementations. Deliberate
corruption of a 3D expectation must still compile but return HTTP 422.
Every request is limited to 128 KiB. The oracle rejects negative face
coefficients, zero spacing, malformed arity and invalid injection bounds.

Reproduce with the repository's real dependencies:

```sh
python3 -m unittest discover -s tests -p 'test_diffusion_dimensional_reduction.py' -v
flow run src/math_diffusion2_smoke.flow
python3 scripts/verify_native.py --require-r
```

The native verification command builds the actual Flow router and exercises
the real `/api/check/flow` and `/api/run/flow` paths; its finite-difference
suite includes this reduction regression. CI on Linux/macOS is the authoritative
native verification. An isolated Python oracle pass alone does **not**
establish native compilation, HTTP, Chromium, R interoperability or RStudio
parity. Compiler-generated multidimensional `field` lowering, boundary
conditions and generalized PDE integration remain separate milestones.
