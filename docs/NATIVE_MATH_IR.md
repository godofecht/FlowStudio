# Native mathematical Flow expression IR (bounded)

The executable native Flow 2.0 evaluator is `src/math_expression_ir.flow`.
It is a **postfix intermediate representation**, not a source parser, a
change to upstream Flow 2.0 grammar, or a general equation compiler.
`src/math_expression_ir_smoke.flow` is executed by the native Linux/macOS
CI gate, and its exact modules are bundled and executed through the
production `/api/check/flow` and `/api/run/flow` routes by
`tests/http_smoke.py`. This does not imply the editor can import relative
modules from its anonymous temporary source files.

`MathProgram` contains at most 64 instructions with validated source-byte
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
| 24 | Boolean literal | dimensionless 0 or 1, exponent zero; produces a typed predicate |
| 25 | exponential | dimensionless numeric operand, finite input in [-60,60]; returns dimensionless numeric |

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

Inputs are limited to 512 UTF-8 bytes and 64 emitted instructions; unknown
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

## Native multi-argument mathematical calls (2026-10-30; Linux/macOS CI verified)

The bounded native source parser now lowers `min(left,right)`,
`max(left,right)`, `norm(first,second)`, `clamp(value,lower,upper)`
and `where(predicate,true_value,false_value)` to the existing
dimension-checked postfix instructions 7, 8, 22, 9 and 19. Arguments
may contain nested calls, arithmetic, explicit typed bindings, comparisons
and eager logical predicates. Commas are legal only inside a recognized
call, with exactly the specified number of arguments. All calls are eager:
`where` does not suppress errors in an unselected branch. Both `where`
branches must have the same physical dimensions; `norm` uses the
existing scale-stable two-component norm. Calls retain function-name
UTF-8 source spans and the existing 16-instruction / 512-byte limits.

The native smoke adds 39 executable cases for numerical values, physical
dimensions, nesting, precedence, source spans, missing and excess arguments,
comma rejection, unit mismatches, reversed clamp bounds, overflow and eager
branch failure. This does **not** implement arbitrary functions, general
source equations, PDE compilation or RStudio parity. All six Linux/macOS jobs passed in
[CI #41010755420](https://github.com/godofecht/FlowStudio/actions/runs/41010755420).
The actual Flow 2.0 compiler and production HTTP routes executed the source
smoke on both platforms. Ubuntu Chromium executed the concatenated checked-in
source through Monaco's real Run control and observed the success marker.
Independent macOS browser acceptance and post-merge main CI remain unverified.

## Native typed scalar equation AST (2026-10-30)

`src/math_equation.flow` compiles a bounded **single top-level `=`** into
`MathEquation`, with independent typed postfix programs for the left and
right expressions. Each expression uses the existing native Flow source parser
and optional explicit physical symbol bindings. Both programs retain original
UTF-8 byte offsets, including the right-hand side. The evaluator rejects
predicates, incompatible physical dimensions, invalid numerical operations,
negative/nonfinite/mismatched tolerance and residual overflow. A successful
evaluation returns the dimensioned residual and whether its absolute value is
within the caller-supplied dimensioned tolerance.

`src/math_equation_smoke.flow` executes analytic dimensional identities,
unequal equations, explicit symbols, Unicode arithmetic, scientific notation,
comparison expressions nested inside `where`, source-span preservation and
fail-closed cases. The native CI matrix and production HTTP compiler execute
the same checked-in code.

This is a scalar equation AST and evaluator, **not** symbolic algebra, an
equation solver, compiler-wide static dimensional inference, a general PDE
grammar, or native Navier–Stokes. It intentionally does not reinterpret `==`
as an equation delimiter.

## Native Unicode mathematical operator lowering (2026-10-30)

The executable Flow 2.0 source-to-IR parser now accepts additional exact
UTF-8 operator spellings: multiplication `⋅` (U+22C5) and `∗` (U+2217),
division `∕` (U+2215), logical conjunction `∧` (U+2227),
disjunction `∨` (U+2228), and prefix negation `¬` (U+00AC).
These share the same native IR opcodes, eager evaluation, precedence,
physical dimension checks, predicate type checks, numerical bounds and
UTF-8 byte-span diagnostics as their existing ASCII counterparts.
They can be combined with numeric units, typed bindings, `where`
expressions and the bounded scalar equation evaluator.

The checked-in native source smoke contains 33 additional positive and
negative assertions, including precedence, exact operator byte spans,
division by zero, incompatible dimensions, eager logical errors and
unsupported Unicode rejection. The equation smoke adds five end-to-end
cases. The CI matrix executes both programs with the actual Flow 2.0
compiler on Linux and macOS, alongside the checked-in Navier–Stokes
program and the production HTTP/Chromium acceptance suites.

This remains a deliberately bounded scalar parser, not full upstream
Flow grammar integration, general Unicode normalization, static
dimensional inference, symbolic PDE lowering, or native Navier–Stokes.

## Native value-independent static dimensional inference (2026-10-30)

`src/math_static.flow` traverses the **actual executable native postfix IR**
and checks operand types, SI exponents, predicate compatibility, stack
balance, instruction spans, integer-power limits, and scalar equation
dimensions **without evaluating numerical values**. The entry points
`infer_math_ir`, `infer_math_expression_source`,
`infer_math_expression_source_with_bindings`, `infer_math_equation`,
and their source/bindings variants return a dimension, predicate flag,
validity, and UTF-8 error position. This is a native Flow 2.0 type-analysis
pass over the bounded scalar AST/IR, not editor-only highlighting.

This deliberately distinguishes **well-typed** from **numerically defined**:
`1m / 0s`, `sqrt(-9m²)`, `0m^-2` and a clamp with reversed numeric bounds
pass dimensional analysis but fail the numerical evaluator. No symbolic
constant propagation, numeric range analysis, unit-scale conversion,
automatic dimension inference for unbound symbols, compiler-wide Flow 2.0
type checking, vector/tensor equations, or general PDE lowering is claimed.
Caller-supplied symbols retain their explicitly declared dimensions; their
values are lowered as IR literals by the existing source parser.

`src/math_static_smoke.flow` tests source spans, physical predicates,
invalid dimensions, equations, the distinction from runtime-domain checks,
and a real 64-instruction program. Both native Linux/macOS CI and production
HTTP check/run acceptance are wired to execute the exact module. Their
success must be confirmed from GitHub Actions before claiming verification.


## Native typed Boolean literals (2026-10-30)

The native Flow source-to-IR parser accepts the reserved lowercase keywords
`true` and `false` as typed predicate literals. They compile to opcode 24,
retain UTF-8 source spans, and execute through the same strict Boolean type
rules as comparisons. Boolean literals work in `not`, `and`, `or`, and
`where` expressions, including nested dimensioned equations. They are not
numeric quantities: arithmetic, numeric comparisons, and equation residuals
reject predicates. Caller bindings cannot shadow either keyword. The IR and
static type pass reject malformed Boolean literal values, units and exponents.

This is a bounded native scalar language extension, not upstream Flow 2.0
grammar integration, general symbolic equations, native Navier–Stokes, or
computed workbench PDE visualization.

## Bound Greek and subscripted physical identifiers (2026-10-30)

The executable native scalar source parser accepts **explicitly bound**
Greek uppercase/lowercase letters (U+0391–U+03A9 except U+03A2, and
U+03B1–U+03C9), as well as ASCII letters/underscores. Continuations may
also contain ASCII digits and Unicode subscript digits U+2080–U+2089.
For example, callers may bind `ρ`, `u₁`, `u₂`, `θ₀` and `Ω` through
`MathBindings` and compile `ρ*norm(u₁,u₂)` or `√(u₁²+u₂²)` into
the **existing native dimension-checked IR**. The same source compiler
is used by scalar equations and static dimensional analysis.

Each name must be 1–32 **UTF-8 bytes**, and the binding table holds at
most eight unique names. Identifier comparisons are exact byte comparisons;
no Unicode normalization, implicit symbol discovery, built-in π constant,
general Greek alphabet extension, superscript identifier components or
arbitrary Unicode letter categories are implied. Unbound and malformed
names fail closed with byte-based source diagnostics. Subscript digits
cannot begin a name; superscript ²/³ remains a power operator.

Native regression entry points are
`flow run src/math_expression_source_smoke.flow`,
`flow run src/math_equation_smoke.flow`, and
`flow run src/math_static_smoke.flow`. Linux/macOS CI also runs the
checked-in Navier–Stokes dialect and production HTTP/Chromium acceptance.
This does **not** add Unicode identifiers to the upstream Flow 2.0 grammar
or implement unbound symbolic inference, tensor/PDE ASTs, native
Navier–Stokes, or computed spatial visualization.

## Signed Unicode superscript powers (native parser; CI validation required)

The executable native Flow source parser recognizes `⁰ ¹ ² ³ ⁴ ⁵ ⁶ ⁷ ⁸`
as postfix integer powers, and `⁺`/`⁻` as optional superscript signs
immediately preceding one or more superscript digits. For example,
`3m⁻²` evaluates to 1/9 m⁻², `2⁺³` evaluates to 8, and
`2m⁻¹*4m` is dimensionless. These forms lower to the same bounded
integer-power opcode as `^n`; they are **not** arbitrary exponent
expressions or changes to the upstream Flow 2.0 grammar.

UTF-8 byte spans cover the complete exponent (including any sign). A
superscript sign without a digit, exponents outside -8 through 8,
unsupported superscript sequences, and chained powers fail closed.
The source, equation and static-inference native smoke programs exercise
numeric values, dimensional propagation, invalid cases and diagnostics.
Linux/macOS native CI and real HTTP acceptance must pass before this
subset is considered verified. General tensor/PDE ASTs and native
Navier–Stokes remain outside its scope.

## Native dimension-checked exponential (2026-10-30)

The actual Flow 2.0 source parser lowers `exp(expression)` to typed postfix
opcode 25. The runtime requires a numeric dimensionless operand, rejects
magnitudes above 60, and returns a dimensionless value. It computes the
exponential without Python, NumPy or platform-specific math-library calls:
halving to [0,0.5], a 24-term Taylor expansion, repeated squaring and a
reciprocal for negative inputs. The finite result remains subject to the
existing 1e30 magnitude bound. Static dimensional inference accepts
`exp(61)` as *well-typed* but the runtime rejects it as out of range.

The checked-in native IR, source, equation and static smoke programs test
analytic values at -60, -1, 0, 1 and 60, source-byte diagnostics, physical
unit rejection, predicate rejection, arity, nested arithmetic and scalar
equation residuals. The existing Linux/macOS native CI and Flow-owned
HTTP acceptance compile and execute those exact programs. This does not
add upstream Flow grammar syntax, general symbolic functions, arbitrary
precision, native Navier–Stokes or automatic editor imports.
