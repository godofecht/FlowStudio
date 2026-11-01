# Native physical dot products

The executable native Flow 2.0 mathematical source compiler accepts `dot2(ax, ay, bx, by)` and `dot3(ax, ay, az, bx, by, bz)`. Both lower into typed postfix instructions (58 and 59), execute in the native runtime, and participate in static SI dimension inference and scalar equation residual evaluation. These are scalar contractions of two- or three-component vectors, not a general tensor AST.

Each input vector must have internally matching physical dimensions; the two vectors may have different dimensions. The result carries the product of their SI dimensions. Predicate operands, inconsistent components, unsupported arity, dimensional overflow, and runaway numerical results fail closed at the function's source byte offset.

```flow
dot2(3m,4m,2/s,1/s)       # 10 m/s
dot3(1m,2m,3m,4/s,5/s,6/s) # 32 m/s
```

Verification is executable rather than editor-only: `flow run src/math_dot_smoke.flow` tests 24 analytic, dimensional, arity and source-span cases, and `src/math_expression_source_http_smoke.flow` checks the production HTTP compile/run path. Linux and macOS CI also execute the checked-in Python/NumPy Navier–Stokes program independently.

This does **not** integrate the upstream Flow grammar, implement arbitrary-rank tensors, or make the Python Navier–Stokes dialect native.
