# Native mathematical Flow expression IR (bounded)

The executable native Flow 2.0 evaluator is `src/math_expression_ir.flow`.
It is a **postfix intermediate representation**, not a source parser, a
change to upstream Flow 2.0 grammar, or a general equation compiler.
`src/math_expression_ir_smoke.flow` is executed by the native Linux/macOS
CI gate, and its exact modules are bundled and executed through the
production `/api/check/flow` and `/api/run/flow` routes by
`tests/http_smoke.py`. This does not imply the editor can import relative
modules from its anonymous temporary source files.

`MathProgram` contains at most 16 instructions with validated source-byte
spans. Each instruction has an integer opcode, a literal quantity, and an
integer exponent. The native evaluator maintains a physical dimension and
a **separate predicate type bit** for every stack value. Boolean predicates
are represented internally by dimensionless 0/1 values; they cannot be
passed to numeric arithmetic, ordering, minimum, maximum, or clamp.
The result exposes `is_predicate` alongside `valid`, `result`, and
`failed_at`.

| Opcode | Operation | Operand contract |
| --- | --- | --- |
| 0 | literal | finite bounded scalar with bounded dimension |
| 1, 2 | add, subtract | equal physical dimensions, numerical values |
| 3, 4 | multiply, divide | numerical values; reject zero divisor |
| 5, 6 | negate, integer power | numerical value; bounded exponent |
| 7, 8 | min, max | equal dimensions, numerical values |
| 9 | clamp | numerical value, lower, upper; equal dimensions and ordered bounds |
| 10–15 | less, less-or-equal, greater, greater-or-equal, equal, not-equal | numerical values of equal dimensions; produce predicate |
| 16, 17, 18 | logical and, or, not | predicate inputs only |
| 19 | where | predicate, numerical true branch, numerical false branch with equal dimensions |

Evaluation is **eager**, including both branches of `where` and both
operands of logical operations. An invalid unselected branch still fails.
No short-circuit or symbolic branch lowering is claimed. Any unsupported
opcode, stack underflow, unbalanced stack, predicate/numeric type mismatch,
physical-unit mismatch, invalid span or nonfinite/unbounded arithmetic
returns `valid=false` and an error position.

Remaining architectural work is tracked by
[issue #198](https://github.com/godofecht/FlowStudio/issues/198):
source lexer and parser, source-to-IR lowering with true source spans,
static symbol/unit inference, vector/tensor equation ASTs, general PDE
lowering, native Navier–Stokes and computed workbench visualization.
The existing `src/math_flow.py` frontend remains Python-backed.
