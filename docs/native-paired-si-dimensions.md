# Native paired SI dimensional constraints

The Flow 2.0 runtime now includes `src/math_dimension_pair.flow`, which operates on parsed native mathematical equation IR rather than editor text or the Python mathematical dialect.

```flow
import .math_dimensions { Dimension, length_dimension, time_dimension, product_dimension, quotient_dimension }
import .math_static { MathDimensionBindings, empty_math_dimension_bindings }
import .math_dimension_pair { MathTwoDimensionSolution, solve_math_equations_two_unknown_dimensions }

function main() -> i32 {
    let known: MathDimensionBindings = empty_math_dimension_bindings()
    let result: MathTwoDimensionSolution = solve_math_equations_two_unknown_dimensions(
        "x*y = 1m²", "x/y = 1s²", known, "x", "y")
    if not result.valid { return 1 }
    # x: m*s, y: m/s
    return 0
}
```

The solver uses an exact two-by-two system independently on SI length, mass, time and temperature exponents. Products, quotients, bounded integer powers, physical square/cube roots, negation and absolute value are lowered from actual parsed equation programs. Each unknown must have a unique, bounded integer SI dimension. Rank-deficient, fractional, out-of-range, malformed, unsupported and inconsistent systems fail closed. Both equations are subsequently checked using the native static dimensional inference implementation.

This is a deliberately bounded **monomial two-equation/two-unknown solver**, not general equation solving. It does not handle sums, nonlinear numerical roots, symbolic tensors, PDEs, arbitrary numbers of unknowns, or upstream Flow grammar integration. The result is a dimensional type solution, not numerical values for the symbols.

`flow run src/math_dimension_pair_smoke.flow` runs positive and rejection assertions. Linux/macOS CI also compiles and executes this module, the existing native numerical suite, and the checked-in Python-backed Navier–Stokes program. Production HTTP acceptance bundles the exact native source modules, checks compilation and execution, and rejects a deliberately corrupted numerical assertion and invalid compiler syntax. The HTTP bundling is a test workaround for the current single-source staging interface, not a claim of native module import support in the editor.


## Three constraints over two unknown dimensions

The native `solve_math_equations_three_constraints_two_unknown_dimensions(first, second, third, known, first_unknown, second_unknown)` entry point tries all three equation pairs as possible full-rank pivots. Each candidate is solved using exact bounded SI-exponent arithmetic, then **all three original equations** are rechecked through the production native static dimension checker. Redundant first/second equations therefore do not prevent a valid solution when the first/third or second/third pair has full rank. An additive equation may serve as a consistency check, but not as a solving pivot.

The checked-in `src/math_dimension_pair_smoke.flow` now contains 15 additional executable positive and rejection cases: redundant-pivot recovery, additive consistency, mixed root constraints, contradictory and malformed third equations, rank deficiency, unsupported functions, duplicate symbols, named known units and binding-count limits. The existing native Flow smoke gate runs these cases on Linux and macOS; no workflow configuration changes are required.

This remains a bounded **three-equation/two-unknown dimensional type solver**. It does not solve numerical values, arbitrary equation systems, additive pivots, general tensor dimensions or PDE declarations. No CI qualification is claimed until the exact PR head passes the existing native and HTTP/browser workflows.
