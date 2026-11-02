# Native anisotropic mixed derivative (Flow 2.0)

The native mathematical Flow source compiler lowers `fdxy(fmm, fpm, fmp, fpp, dx, dy)` to typed postfix opcode 88. Samples are ordered at the four corners `(--, +-, -+, ++)`, where the first sign denotes the x offset and the second denotes the y offset.

The numerical runtime evaluates

`((fpp - fmp) - (fpm - fmm)) / (4 * dx * dy)`

after normalizing the four samples to reduce intermediate overflow. Both spacings must be positive finite physical lengths; all four samples must have matching SI dimensions and must not be predicates. The result has the field dimension divided by length squared. Static inference verifies dimensions and types but deliberately does not reject a zero-valued spacing until runtime.

The checked-in `src/math_mixed_derivative_smoke.flow` runs 25 native numerical, SI, parser-span, equation and negative assertions. It includes an independently manufactured polynomial `f(x,y)=x²y²` at `(1,2)` with anisotropic spacings `(0.5,0.25)`, for which the mixed derivative is exactly 8. `tests/http_finite_difference_smoke.py` compiles and runs the identical source through production HTTP, then changes the expected answer and requires HTTP 422.

This is a bounded scalar finite-difference primitive, **not** a general symbolic mixed-derivative AST, arbitrary tensor contraction or native Navier–Stokes solver. The upstream Flow 2.0 grammar and generalized PDE compilation remain incomplete.
