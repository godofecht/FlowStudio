# Native SI-aware quantiles

The native Flow 2.0 mathematical source frontend compiles `quantile(p, x1, ..., xn)` into typed postfix IR opcode 80. This is executable in the native runtime and production HTTP workbench, not an editor-only snippet.

The first operand is a dimensionless probability in the closed interval [0, 1]; the remaining 1–7 observations must be numeric and have identical SI dimensions. Mixed compatible unit scales are converted to base units by the existing literal parser. Booleans, incompatible dimensions, malformed argument counts and probabilities outside [0, 1] fail closed with source spans.

The estimator is the deterministic Hyndman–Fan Type 7 quantile: sort observations, compute rank `(n - 1) * p`, then linearly interpolate between adjacent ranks. Observations are normalized by their maximum magnitude before sorting and interpolation to avoid premature overflow for opposite-signed large values. The result retains the observations' physical dimension.

The native source smoke test covers endpoints, fractional ranks, single observations, nested expressions, implicit multiplication, large-magnitude interpolation, source spans, and invalid inputs. The HTTP smoke fixture executes the same IR through the production server. The implementation is a bounded scalar statistical primitive; indexed symbolic reductions and arbitrary-rank tensor operators are not yet implemented.
