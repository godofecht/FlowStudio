# Shared-face periodic 3D diffusion acceptance

This regression uses the production Flow 2.0 mathematical compiler's SI-aware
`diffusion3(center,left,right,down,up,back,front,kleft,kright,kdown,kup,kback,kfront,dx,dy,dz)`
operator, not a Python PDE implementation substituted for native execution.

A seed-20261102 deterministic 3×3×3 periodic grid assigns 27 quarter-Kelvin
cell values and three independent arrays of 27 positive eighth-unit face
diffusivities (m²/s). Each positive-direction face coefficient is reused
as the neighboring cell's negative-direction coefficient. Grid spacings
are 1, 2 and 4 metres. An exact-rational independent oracle calculates
all 27 K/s derivatives, including distinct forward/backward coefficients.

The native Flow HTTP acceptance injects the 27 source expressions in seven
batches of at most four into the actual checked-in compiler smoke program.
Every batch must pass both `/api/check/flow` and `/api/run/flow`, with a
128 KiB source ceiling. A deliberately corrupted numerical expectation must
still compile but fail at runtime with HTTP 422.

The exact oracle checks zero total derivative (conservation), strictly
negative `sum(u * du/dt)`, translation covariance under a one-cell cyclic
shift, and one forward-Euler step at dt=1/16 s preserving total mass,
the maximum principle and decreasing quadratic energy. These are global
properties that isolated scalar stencil tests cannot establish.

Persistent base R independently computes all 27 face-flux divergences via
real `/api/run/r` HTTP. Persistent CPython receives bounded R output
and independently reconstructs exact `Fraction` derivatives, checks global
mass and energy and requires HTTP 422 on a deliberately corrupted numerical
value and a truncated result frame. Both interpreters must recover after
the failures. R/Python response frames are limited to 24 KiB.

Reproduce from the repository root:

```sh
python3 -m unittest discover -s tests -p 'test_diffusion3_periodic.py' -v
python3 scripts/verify_native.py --require-r
```

The first command verifies the independent numerical generator; the second
requires the installed pinned Flow compiler, production HTTP server and R
runtime. Exact-head Linux/macOS CI must be inspected before calling the
end-to-end tests passed. This is finite-volume verification assembled from
native scalar expressions, **not** generalized compiler-generated 3D
`field` declarations or complete RStudio parity.
