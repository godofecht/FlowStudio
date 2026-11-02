# Native conservative 2D diffusion

The executable Flow mathematical source parser recognizes

`diffusion2(center, left, right, down, up, kleft, kright, kdown, kup, dx, dy)`

and lowers it to opcode 90 of the native typed postfix IR. The implementation shares its face-flux kernel with `diffusion3` (opcode 89). Both operations are eager, scalar, and bounded. They are **not** a general PDE AST or solver.

On a rectangular grid with positive spacings, it evaluates

```text
[kright*(right-center) - kleft*(center-left)] / dx²
+ [kup*(up-center) - kdown*(center-down)] / dy²
```

All five field samples must have the same SI dimension. Each face diffusivity must have dimension length²/time and be nonnegative; `dx` and `dy` must be positive lengths. The output has the field dimension divided by time. Predicates, incompatible dimensions, zero or negative spacing, negative diffusivity, and nonfinite or unbounded numerical results are rejected. Static inference checks dimensions but intentionally does not prove value positivity.

The independent `Fraction` oracle uses a seeded 3×3 periodic grid with coefficients shared across neighboring faces, verifying exact zero total rate, discrete energy dissipation, a mass-conserving explicit Euler step, a maximum principle for the chosen stable step, and translation covariance. All nine oracle cells are also injected into actual native HTTP compile-and-run requests in three bounded batches, including a deliberately incorrect numerical expectation that must return HTTP 422.

Reproduce:

```sh
flow run src/math_diffusion2_smoke.flow
python3 -m unittest discover -s tests -p 'test_diffusion2_oracle.py' -v
python3 scripts/verify_native.py --require-r
```

Linux/macOS CI runs the checked-in native smoke and the existing native HTTP acceptance suite (which now includes these nine 2D cases). The checked-in Navier–Stokes and heat regressions remain part of that CI suite. Passing this gate does not establish full mathematical Flow grammar, symbolic PDE lowering, a native Navier–Stokes solver, or multidimensional visualization.
