# Heterogeneous three-dimensional zero-Dirichlet diffusion qualification

Seed 20261102 defines 27 interior cells in a 3×3×3 grid, 54 independently
seeded interior shared-face conductances, 54 independently seeded exterior
conductances, anisotropic spacings (1/2, 3/4, 5/4), and zero prescribed
temperature at every external face. The boundary flux uses the half-cell
distance: on the left, +2*k*u/h; on the right, -2*k*u/h. This is deliberately
**not** periodic or zero-normal-flux (Neumann) diffusion.

The checked-in exact-Fraction finite-volume oracle evolves 24 forward-Euler
steps at dt=1/128, producing 25 states (675 exact cell values). An
independently assembled 27×27 substochastic Euler transition matrix verifies
every state without reusing the flux/divergence implementation. The suite
asserts the discrete Green identity including all boundary losses, strict
positive-state mass loss, energy decay, maximum principle, a zero fixed
point, 12+12 restart equivalence, deterministic replay, malformed states,
nonfinite inputs, and timestep limits. Decimal arithmetic independently
reconstructs all 39 serialized native numerical expectations.

The production Flow mathematical compiler and actual HTTP check/run endpoints
must execute all 27 initial and 12 final sampled `fluxdiv3` expressions,
in at-most-three-case batches below the 128 KiB source ceiling. A deliberately
wrong numerical expectation must compile, return HTTP 422 on execution, and
leave the production server usable. The existing native smoke independently
checks static SI inference, wrong dimensions, zero spacings, source spans,
and malformed arity. The scalar flux inputs here use the existing normalized
K/m `fluxdiv3` unit convention; they are not a complete SI-aware diffusion
time-evolution field.

Reproduce the exact oracle:

    python3 -m unittest discover -s tests -p 'test_dirichlet_diffusion3.py' -v

With the production FlowStudio server listening on localhost port 8751:

    python3 tests/http_dirichlet_diffusion3_smoke.py

Full native compilation, HTTP, R/Python and browser qualification:

    python3 scripts/verify_native.py --require-r

The native compiler evaluates 39 bounded scalar stencils. The complete
24-step evolution is independently verified in Python, **not** executed
as compiler-generated multidimensional Flow `field` lowering. R/Python
cross-runtime verification of the full Dirichlet trajectory and independent
macOS physical Chromium are separate milestones. No hosted CI workflow
configuration is changed by this qualification.
