# Native 8×8 three-mode transport acceptance

The production Flow 2.0 `examples/native_advection_diffusion_2d.flow` now checks both the previously verified nonsquare 5×7 three-mode case and an independent 8×8 periodic three-mode case. The 8×8 run has 64 cellwise comparisons against exact semidiscrete Fourier propagation at t=0.4, 4/8/16/32-step RK4 convergence, mass conservation, linear superposition, deterministic replay and invalid parameter/step rejection. The grid is manually bounded at 8×8; this is **not** a general native PDE compiler or full RStudio parity.

The independent standard-library oracle `tests/test_native_transport_fourier8_oracle.py` computes complex Fourier eigenvalues and an independently written direct-stencil RK4 solution, with analytic coefficients, translation, linearity, deterministic replay and mutation-sensitivity tests. The existing CI workflow (unchanged) executes Python discovery, the actual native Flow program, the production HTTP compile/run path and Ubuntu Chromium's real Monaco Run button for this exact file on Linux/macOS as applicable.

**Verification status:** Pending new PR CI. Independently calculated locally before submission: maximum absolute 64-cell errors at 4/8/16/32 steps were 3.4010714163e-6, 1.9425880171e-7, 1.1585966964e-8 and 7.0704431199e-10, respectively. The local host does not have the pinned Flow 2.0 compiler or R; native/HTTP/physical-browser tests must be confirmed from CI, not assumed.

The original PR #218 is stale against the later 5×7 acceptance and remains separate until this rebased PR is independently verified.
