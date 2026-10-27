# Mathematical Flow syntax proposal

Status: **experimental editor syntax only**. The Flow compiler and runtime do not yet parse or execute these constructs. The examples are not execution tests.

## Naming and grammar

- Values, fields, parameters and constants use lowerCamelCase.
- Types, functions, models, solvers and domains use UpperCamelCase.
- Keywords are lowercase: `domain`, `model`, `solver`, `field`, `dynamics`, `constraint`, `initial`, `spatial`, `temporal`, `pressure`, `enforce`, `via`, `on`, `for`.
- A domain block declares spatial geometry and boundary conditions.
- A model block declares fields, physical dynamics, constraints and initial conditions.
- A solver block selects discretization, integration, pressure solution and constraint enforcement.
- `▷` composes transformations left-to-right.
- `∂ₜ`, `∇`, `∇ ·`, `∇ ×`, `∇²` and `∫` are mathematical operators, not text substitutions.
- `×` is a dimension/product operator; `·` is a dot product.
- Unicode subscript and superscript sequences require dedicated lexical treatment, not a blanket identifier rule.
- Unit literals such as `1m`, `1kg/m³` and `10⁻⁴s` require dimensional type checking.
- `Observe` and `Visualize` are runtime transforms, not implicit language keywords.

## Compiler acceptance criteria

1. Unicode-aware lexer preserves byte offsets and diagnostics; rejects malformed operator sequences.
2. Parser produces typed domain/model/solver declarations and equation expression trees.
3. Name resolution distinguishes field values from types and functions, checks casing diagnostics.
4. Dimensional analysis checks equations and initial conditions.
5. Operator lowering uses discrete divergence and gradient that form a compatible projection Laplacian.
6. Solver validates boundary/pressure method compatibility, pressure gauge, time integration and stage projection.
7. Runtime executes a periodic vortex example and measures divergence, convergence and kinetic energy.
8. CI tests the real compiler and runtime, not regex or mock execution.

## Editor scope of this change

The editor completion vocabulary now exposes the proposed constructs and a model scaffold. This is authoring assistance only; no compiler support is implied.
