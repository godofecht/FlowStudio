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


## Native source-level absolute value and square root (2026-10-30)

The actual Flow 2.0 source parser now lowers `abs(expression)`,
`sqrt(expression)`, and the Unicode prefix radical `√expression` to
existing typed postfix IR opcodes 20 and 21. The ASCII function names require
an immediate opening parenthesis. The Unicode radical is a prefix operator
that may also precede parentheses. These operations are evaluated by the
native runtime rather than an editor-only completion or the Python dialect.

Absolute value preserves physical units. Square root rejects negative
radicands and odd SI dimension exponents, halving even exponents. The parser
emits function calls when their closing parenthesis is consumed, ensuring
`sqrt(9m²)^2` applies the outer power **after** the square root.
The Unicode radical retains its three-byte UTF-8 source span; native
dimensional failures point to the function/radical position.

The native source smoke adds 28 executable cases covering nested functions,
signed quantities, dimensional composition, postfix powers, source offsets,
invalid radicands and unsupported syntax. Existing Linux/macOS native CI
executes `src/math_expression_source_smoke.flow`, and the production HTTP
acceptance compiles and runs the exact module. CI results must be checked
before this feature is treated as verified.

This is still a bounded scalar parser. It does not accept symbolic
variables, general functions, arbitrary exponent expressions, equations,
spatial derivatives, upstream Flow grammar extensions or general PDEs.

## Explicit typed native symbol bindings (2026-10-30; Linux/macOS CI verified)

The native Flow 2.0 expression parser now accepts caller-provided, **explicitly
bound** ASCII identifiers through `MathSymbol`, `MathBindings`,
`parse_math_expression_with_bindings` and
`evaluate_math_expression_with_bindings`. A binding supplies a concrete
`Quantity`, including its length/mass/time/temperature dimensions. The parser
lowers every resolved name to an ordinary typed literal in the existing
`MathProgram`; the runtime therefore retains its dimensional checks,
1e30 magnitude bound and UTF-8 source spans. Existing no-binding entry points
remain unchanged and reject unknown identifiers.

There are at most eight unique names, each 1–32 ASCII letters, digits or
underscores, beginning with a letter or underscore. Missing, duplicate,
malformed, out-of-range and nonfinite/unbounded bindings fail closed. Symbols
cannot introduce implicit multiplication, execute code, define functions or
access external/global state. The smoke program includes 34 new positive,
negative, unit, source-span and overflow assertions, including dimensioned
force, inverse powers, square roots, and Unicode source offsets. The exact
smoke program is already exercised by native `flow run` and real HTTP
compiler/run acceptance in the unchanged Linux/macOS CI pipeline.

This is **not** a general compiler symbol table, static unit inference,
upstream grammar extension, function definitions, spatial derivatives or
PDE compiler. All six Linux/macOS jobs passed in
[CI #41005093641](https://github.com/godofecht/FlowStudio/actions/runs/41005093641),
including the real native Flow compiler, this source smoke, production HTTP
compile/run acceptance, both R/C FlowJIT jobs and existing Ubuntu Chromium
workflows. No dedicated physical-browser interaction with the new symbol
binding API was performed; post-merge main CI remains pending.

## Native source-level dimension-checked comparisons (2026-10-30; CI pending)

The executable `src/math_expression_source.flow` now lowers ASCII
`< <= > >= == !=` and UTF-8 `≤ ≥ ≠` into the existing native typed
IR comparison opcodes 10–15. Comparison precedence is below addition,
subtraction, multiplication and division. Results carry a separate
`is_predicate` type bit and dimensionless 0/1 value; operands must be
numeric quantities with exactly matching SI dimensions. A predicate
cannot be silently used in arithmetic or a second comparison.
Source errors retain the original operator byte span, including three-byte
Unicode symbols. Lone `=`, `!`, incomplete and malformed operators
fail closed. This does not add logical source operators, implicit truthiness,
general equations, static inference, or upstream Flow grammar integration.

The native `math_expression_source_smoke.flow` adds 28 positive and
negative acceptance cases for comparison truth values, arithmetic
precedence, explicit typed symbol bindings, SI unit mismatch, chained
comparison rejection, invalid syntax and UTF-8 spans. Linux/macOS native
CI and production HTTP acceptance must pass before this change is merged.

## Native source-level logical predicates (2026-10-30; CI pending)

The executable native Flow source parser now recognizes the reserved ASCII
keywords `not`, `and` and `or`. These lower to the existing typed IR
opcodes 18, 16 and 17. Precedence is arithmetic, comparisons, `not`,
`and`, then `or`; `not 1<2` means `not (1<2)`. Parentheses override
the default order. The IR requires predicate operands and returns a
predicate; numerical values cannot silently become Boolean values.
All logical operations are **eager**, including `and` and `or`; an invalid
right operand still fails even if the left value determines the truth
value. Reserved keywords cannot be bound as numeric symbols.

The checked-in native smoke adds 36 executable positive, negative,
precedence, UTF-8/source-span, typed-binding and eager-error assertions.
The existing Linux/macOS CI runs the actual Flow program, the original
Navier–Stokes regression and production HTTP/Chromium acceptance. This is
not compiler-wide Flow grammar integration, lazy conditional execution,
general equation syntax, static unit inference or native PDE lowering.
