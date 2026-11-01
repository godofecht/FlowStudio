# Native smooth transitions in mathematical Flow

The native Flow 2.0 source compiler lowers `smoothstep(edge0, edge1, x)` to
typed postfix opcode 67 and `smootherstep(edge0, edge1, x)` to opcode 68.
These are executable mathematical expressions, not editor snippets. They are
useful for smooth spatial forcing, material coefficients and transition masks.

The three inputs must be **numeric quantities with identical SI dimensions**.
The lower edge must be strictly less than the upper edge. Results are numeric
dimensionless scalars in [0, 1], exactly 0 below the lower edge and exactly 1
above the upper edge. A Boolean is not interchangeable with a scalar.
`smoothstep` evaluates `t²(3−2t)` and `smootherstep` evaluates
`t³(6t²−15t+10)` for `t=(x−edge0)/(edge1−edge0)` inside the interval.

Native examples: `smoothstep(0m,10m,2.5m)` = 0.15625;
`smootherstep(0m,10m,2.5m)` = 0.103515625;
`smoothstep(0,2π,π)` = 0.5.

`flow run src/math_smooth_transition_smoke.flow` runs 30 native analytical,
type, arity, domain, source-span and static-inference checks. The production
HTTP acceptance fixture also compiles and executes both operations. CI runs
the native suite on Linux and macOS alongside the checked-in Navier–Stokes
and analytical PDE regressions. This is bounded scalar expression support,
**not** arbitrary-rank tensor/PDE grammar integration or a native
Navier–Stokes compiler.
