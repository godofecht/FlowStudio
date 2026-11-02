# Native conservative 1D diffusion

The actual native mathematical Flow parser, typed postfix IR runtime and static SI checker execute `diffusion1(center,left,right,kleft,kright,dx)` (opcode 91). This shares the same face-flux kernel as `diffusion2` and `diffusion3`, and evaluates

```text
[kright*(right-center) - kleft*(center-left)] / dx²
```

The three field samples have the same SI dimension. Face coefficients are nonnegative m²/s; spacing is positive m. The output has field units/s. The native runtime rejects invalid dimensions, predicates, negative coefficients, nonpositive spacing, nonfinite values and malformed arity. Static inference validates dimensions but not positivity.

`flow run src/math_diffusion1_smoke.flow` exercises real compilation and execution. `tests/test_diffusion1_oracle.py` independently calculates exact-rational periodic conservative fluxes, and `tests/http_finite_difference_smoke.py` executes each cell through the production Flow HTTP compiler/runtime with a deliberate 422 numerical-sabotage check.

This is a bounded scalar operator, not a general field/tensor AST, native PDE solver or visualization engine.
