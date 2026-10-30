# Two-field native Flow PDE acceptance (48 + 48 cells)

The pinned upstream Flow 2.0 compiler lowers two distinct `field` declarations
and their `evolves as laplacian` and Dirichlet `boundary` declarations into
`A_field_step` and `B_field_step`. The fields have unequal nonzero endpoints
(1, 2 and -0.5, 0.5) and independently chosen stable Euler ratios (0.4, 0.2).
This is **two independent fields**, not coupled PDE lowering.

Each 48-cell initial condition combines a linear Dirichlet equilibrium and two
discrete sine modes. All 288 output values at 16, 64 and 128 steps are checked
inside the compiled Flow program against semidiscrete eigenvalue references.
The independent Python oracle derives all 384 initial/reference values again
and executes a separate direct-stencil implementation. Both fields must
separately conserve affine equilibria, lose residual energy, compose their
semigroups, replay deterministically and reject malformed parameters and
boundary values without changing either output. Work is capped at 2048 steps
and 196608 total cell-steps.

```sh
flow run examples/native_field_dual48.flow
python3 -m unittest discover -s tests -p 'test_native_field_dual48_oracle.py' -v
python3 scripts/verify_native.py --require-r
```

The production `/api/check/flow` and `/api/run/flow` smoke and actual
Chromium Monaco Run acceptance use the same checked-in Flow source. Python
oracle success alone is not native Flow verification. General coupled 2D PDE
operators, physical plotting, live Flow/R debugging, and remote multi-user
isolation remain incomplete.
