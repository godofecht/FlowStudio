# Native implicit multiplication before function calls

The executable Flow 2.0 mathematical source parser now lowers a complete
scalar primary immediately followed by a recognized function call to the
existing typed multiplication opcode. Examples include `2sin(π/2)`,
`3mcos(0)`, `(1+2)sin(π/2)`, `sin(π/2)cos(0)`, and
`2sqrt(9*1m²)`. This is actual native source-to-postfix-IR lowering,
not a Monaco editor substitution.

The inserted multiplication has the same left-associative precedence as
`*` and `/`. Function calls and their postfix powers remain primary
expressions. The synthetic instruction has a zero-width source span at
the first byte of the function name. Function instructions retain their
original UTF-8 byte offsets. Existing runtime and static dimensional
checks apply without a separate implementation.

When a numeric literal is adjacent to a recognized call, the parser
prefers the call over an SI suffix: `2sin(π/2)` is a product rather
than `2s` followed by an unknown identifier. Bare `2min` still
means 120 seconds, while `2min(1m,3m)` means twice the minimum of
the two lengths. Unit-plus-function forms such as `2mcos(0)` and
`2scos(0)` retain their units. Unknown names and malformed function
arities fail closed.

`flow run src/math_implicit_function_products_smoke.flow` executes
41 analytical, precedence, dimensional, diagnostic, source-span and
equation checks on the native Flow runtime. The Linux/macOS native
CI matrix executes the same file alongside the checked-in
Python-backed Navier–Stokes model and production HTTP acceptance.

This change does not unify the upstream Flow 2.0 grammar, provide
arbitrary-rank tensor/PDE ASTs, or replace the Python-backed
Navier–Stokes solver with native Flow.
