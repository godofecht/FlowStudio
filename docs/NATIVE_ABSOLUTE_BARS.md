# Native mathematical absolute-value bars

The native Flow 2.0 mathematical source-to-IR parser accepts balanced
`|expression|` and lowers each pair to the same executable, SI-aware
`abs(expression)` opcode 20 as a recognized function call. Bars can nest,
enclose parentheses and recognized functions, and participate in implicit
multiplication such as `2|-3m|` and `|2m||3s|`. Delimiter identity is
checked: mismatched `|x)` and `(x|` are rejected, not repaired.

The absolute-value operator preserves physical dimensions and rejects typed
Boolean operands. The emitted opcode retains the original UTF-8 source span
covering both bars. The existing static inference, scalar equation evaluator,
native HTTP compiler and browser Run route consume the same lowered IR.
This is bounded scalar source syntax, not an arbitrary-rank tensor AST or
upstream Flow compiler grammar extension.

Run `flow run src/math_absolute_bars_smoke.flow` for 43 native assertions
covering numerical values, Unicode, SI dimensions, nesting, implicit
products, source spans, static inference, equations and malformed input.
The production HTTP fixture executes four additional assertions. CI runs
these on Linux and macOS with the checked-in Navier–Stokes program.
