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
