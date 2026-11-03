# Executable typed logical connectives in the mathematical Flow PDE dialect

The bounded `src/math_flow_expr.py` compiler and the actual `src/math_flow.py`
source lexer now accept `⊻`/`xor`, `⇒`/`→`/`implies` and
`⇔`/`↔`/`iff` inside typed `where(predicate, true, false)`
expressions. They lower to checked predicate AST nodes and NumPy operations
on actual solver arrays, not editor snippets.

Precedence (tight to loose) is comparison, conjunction, XOR, disjunction,
implication, equivalence. Implication is right associative; equivalence and
XOR are left associative. A Boolean predicate cannot be silently coerced to a
dimensionless number or used as a PDE rate. Both branches of `where` retain
the existing coherent SI-dimension check.

`examples/heat_logical_arrows.flow` runs a real periodic 32×32 RK2 heat
equation with forcing `2K/s` only where
`(x<0.5m ⇒ y<0.5m) ⊻ (x<0.5m ⇔ y<0.5m)`. This is exactly one quadrant
of the cell-centered grid. Diffusion conserves the spatial mean, so after
`0.01s` the independently predicted mean is `300.005K`.

Reproduce with:

```sh
python3 -m pip install numpy==2.1.3
python3 -m unittest discover -s tests -p test_math_flow_logical_arrows.py -v
python3 src/math_flow.py --check examples/heat_logical_arrows.flow
python3 src/math_flow.py examples/heat_logical_arrows.flow
python3 src/math_flow.py examples/navier_stokes_smoke.flow --grid 16
```

The repository's unchanged Linux/macOS CI must also execute native Flow
numerical kernels, production HTTP and the checked-in Navier–Stokes program.
This feature is specifically the Python/NumPy-backed mathematical PDE
dialect. It does not imply integration into the upstream Flow 2.0 grammar,
general tensor ASTs or fully native Navier–Stokes.
