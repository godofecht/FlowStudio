# Native Flow matrix determinants

The executable Flow 2.0 mathematical source parser accepts row-major scalar
`det2(a,b,c,d)`, `det3(a,...,i)` and `det4(a,...,p)` calls. These lower
to typed postfix opcodes 70, 71 and 72, respectively. This is a bounded
scalar-matrix interface, not an arbitrary-rank matrix AST or upstream grammar
integration.

The `det4` runtime evaluates all 24 signed permutations of the four
columns. `math_permutation4` uses a factorial-number-system enumeration
shared by native evaluation and static dimensional inference. Every
permutation's product must have identical SI dimensions, including terms
whose numeric value is zero; predicates are rejected. Intermediate
multiplications and signed sums are bounded by the same finite magnitude
limit as the other native mathematical operations. Ill-typed, malformed or
out-of-range calls fail closed at the source function's UTF-8 byte offset.

For example, `det4(1m,0m,0m,0m,0s,1s,0s,0s,0K,0K,1K,0K,0kg,0kg,0kg,1kg)`
returns a scalar with dimensions length × time × temperature × mass and
value 1. The same source can be statically inferred and used in native
equation residuals.

`flow run src/math_determinant_smoke.flow` executes analytic identity,
row-swap, singular, nontrivial 4×4, physical-unit, malformed-arity,
predicate, overflow, equation and permutation-parity regressions. The
production HTTP test `tests/http_determinant_smoke.py` additionally
compiles and executes 43 deterministic exact-integer cases checked by
independent Bareiss elimination and signed permutation oracles, including
transpose, row-swap and row-addition metamorphisms. A deliberately
sabotaged numerical expectation must compile and fail at runtime with
HTTP 422. CI runs this on Linux and macOS with the pinned upstream Flow
2.0 compiler, alongside the checked-in Navier–Stokes and heat programs.

This is not yet a generalized tensor/matrix type system, native
Navier–Stokes solver or computed multidimensional visualization.
