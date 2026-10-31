# Native mathematical equation systems

The checked-in `src/math_equation_system.flow` implements a bounded native Flow 2.0 equation-system AST. It splits one UTF-8 source into **1–8 top-level semicolon-delimited scalar equations**, compiles each through `src/math_equation.flow` and `src/math_expression_source.flow`, and rebases every typed IR instruction to the original full-source byte offset.

`parse_math_equation_system_with_bindings(source, bindings)` supports the existing explicit typed symbol bindings. `evaluate_math_equation_system(system, tolerances)` evaluates every compiled equation through the production dimension-checked native runtime. Each equation has an independently dimensioned nonnegative tolerance. The result distinguishes **invalid execution** from **valid but unsatisfied constraints**, exposes per-equation physical residuals, and identifies the first invalid equation and original UTF-8 source byte position.

The parser fails closed on empty equations, trailing separators, nested separators, more than eight equations, unmatched parentheses, invalid bindings, and malformed scalar equations. Input is limited to 512 UTF-8 bytes. It does not perform symbolic equation solving, unknown inference, general vector/tensor ASTs, or PDE discretization. It is **not** integrated into the upstream Flow 2.0 grammar.

`flow run src/math_equation_system_smoke.flow` executes native numerical, dimensional, source-span, Unicode-binding, tolerance and invalid-input assertions. `.github/workflows/ci.yml` requires real Linux/macOS execution. `tests/http_smoke.py` bundles the exact checked-in Flow modules for production `/api/check/flow` and `/api/run/flow` acceptance, not editor-only text.

The existing Python-backed Navier–Stokes and analytic native numerical suites remain CI gates. Overall mathematical language completion remains tracked by [issue #198](https://github.com/godofecht/FlowStudio/issues/198).

The eight-equation stress case combines Unicode arithmetic, nested conditionals and logarithms, inverse-square units, time/length/temperature dimensions and independent per-equation tolerances in one 122-byte source. It asserts original UTF-8 byte offsets, all eight native residuals, a late numerical mismatch, a tolerance-only change, and fail-closed diagnostics for an eighth-equation dimensional error and an unknown symbol. The same checked-in smoke program is compiled and run by native CI and the production Flow HTTP acceptance. No Python evaluator substitutes for its results.
