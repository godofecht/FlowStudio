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
| 20 | absolute | numerical operand; preserves its physical dimension |
| 21 | square root | nonnegative numerical operand; every physical dimension exponent must be even |
| 22 | hypot | two numerical operands with identical dimensions; scaled two-component Euclidean norm |

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

## 2026-10-30: bounded native physical norms (CI pending)

The native IR now implements absolute value, a deterministic 72-iteration
Newton square root and a scaled two-component Euclidean norm. A square root
rejects negative radicands and odd physical exponents; hypot requires matching
units and does not square unscaled large inputs. Intermediate and final values
remain subject to the 1e30 magnitude bound. The native
`src/math_expression_ir_smoke.flow` checks the dimensioned Pythagorean
identity, zero and extreme magnitudes, predicate rejection, mismatched units,
invalid opcodes and overflow. Existing Linux/macOS CI and production HTTP
acceptance run that exact native program. These are eager postfix operations,
not parsed source-level `sqrt`, `abs` or `hypot` calls. Independent
browser execution of the new operations and post-merge main CI are pending.

## Native infix-to-IR lowering (2026-10-30)

`src/math_expression_source.flow` parses an explicitly bounded subset of
physical scalar infix expressions **in native Flow 2.0**. Its public
`parse_math_expression` returns a postfix `MathProgram` with UTF-8 source
byte spans, and `evaluate_math_expression` executes that program through
the existing dimension-checked native IR. This is real compiler/runtime code,
not Monaco snippets or a Python parser. It accepts decimal/scientific numeric
literals, optional immediate SI suffixes `m`, `s`, `kg`, `K`, ASCII
`+ - * /`, Unicode `× ÷ −`, unary signs and parentheses, with conventional
multiplication/division precedence and left associativity.

Inputs are limited to 512 UTF-8 bytes and 16 emitted instructions; unknown
identifiers, implicit multiplication, unsupported Unicode, malformed numbers,
invalid units and incomplete expressions fail closed.
Runtime dimensional errors and division by zero retain the operator's
original source byte offset. No identifiers, symbolic calculus, static
inference, arbitrary function calls, general equation ASTs or PDE syntax
are accepted by this parser. This is a source-to-IR *subset*, not a change to
upstream Flow 2.0 grammar.

`src/math_expression_source_smoke.flow` exercises nested precedence,
unit-bearing arithmetic, Unicode lowering, numerical magnitudes and
diagnostic offsets. Both Linux and macOS CI run it through `flow run`;
the production HTTP acceptance also checks and runs the exact modules.

## Native integer-power lowering (2026-10-30; verification pending)

The native source parser lowers immediate signed integer exponents `^n` and
UTF-8 postfix `²`/`³` into opcode 6 of the existing dimension-checked Flow
IR. The exponent range is -8 through +8; a sign and digits must follow `^`
without intervening whitespace. Powers bind to the preceding primary before
pending unary signs: `-2m^2` evaluates to -4 m², while `(-2m)^2` is +4 m².
`2m^-2` carries inverse-area dimensions. Chained powers such as `2^3^2`
fail closed instead of silently assuming associativity. All power instruction
spans retain the exact original UTF-8 byte offsets, including the two-byte
superscripts, and overflow, dimensional mismatch, zero to a negative power,
unsupported superscripts and instruction limits remain failures.

The executable `src/math_expression_source_smoke.flow` checks 35 additional
positive, numerical, dimensional, source-span and negative paths, including
a nested dimensioned rational expression. The existing Linux/macOS native
CI and production HTTP acceptance compile and execute this exact smoke
program; a successful CI run is required before claiming verification.
This does not yet support arbitrary exponent expressions, symbolic functions,
general source-to-IR lowering or native PDE declarations.
