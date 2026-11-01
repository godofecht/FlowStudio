# Native Flow matrix determinants

The executable mathematical source parser, typed postfix IR and static SI
inference support `det2(a,b,c,d)` and
`det3(a,b,c,d,e,f,g,h,i)`, with entries supplied in row-major order.
These are native Flow operations, not editor snippets or Python delegation.

`det2(1m,2s,3m,4s)` evaluates to `-2 m·s`.
`det3(1m,2m,3m,0s,1s,4s,5K,6K,0K)` evaluates to `1 m·s·K`.

Every signed permutation product must have the same SI dimension. This permits
heterogeneous rows and columns while rejecting determinants whose terms cannot
be added. Boolean operands, malformed arity, out-of-bounds physical exponents,
and intermediate numeric overflow fail closed with source offsets. Static
inference checks units without evaluating numeric values or overflow domains.

Run `flow run src/math_determinant_smoke.flow`. CI runs this with the checked-in
Navier–Stokes program and other native numerical acceptance on Linux and macOS.

This remains a bounded scalar-call dialect: no general matrix literals,
arbitrary-rank tensor AST, symbolic differentiation, or native Navier–Stokes
solver is implied by these operations.
