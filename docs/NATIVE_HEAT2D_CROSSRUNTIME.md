# Native 2D anisotropic evolution: independent HTTP qualification

The checked-in [Flow program](../examples/native_evolution_heat2d.flow)
uses Flow 2.0's native evolution declaration and its compiler-generated
AnisotropicHeat2D_step RK4 solver. It is **not** the separate Python-backed
mathematical Flow frontend and does not establish general tensor/PDE
lowering. Its four states are a periodic 2×2 grid.

The initial state in row-major order is (3.6, 1.6, 4.0, 2.8).
The x- and y-direction diffusion rates are respectively 0.02/0.5²
and 0.04/0.5²; periodic 2-cell axes contribute a factor of two per
neighbor. The semidiscrete eigenvalues are 0, -0.32, -0.64, -0.96.
The exact one-second solution is

    (3 + .8 ex - .4 ey + .2 exy,
     3 - .8 ex - .4 ey - .2 exy,
     3 + .8 ex + .4 ey - .2 exy,
     3 - .8 ex + .4 ey + .2 exy)

where ex = exp(-0.32), ey = exp(-0.64) and exy = exp(-0.96).

The real Flow program runs 64 RK4 steps, asserts convergence against
8/16/32-step refinements, semigroup composition, deterministic replay,
transposition covariance, mass, maximum bounds, equilibrium, invalid
diffusivities and a 100,000-step guard. It emits all four final computed
values between FLOWSTUDIO_HEAT2D_RK4_V1 64 and
FLOWSTUDIO_HEAT2D_RK4_END, preserving the original success marker.

The mandatory native acceptance
[tests/http_native_heat2d_interop.py](../tests/http_native_heat2d_interop.py)
compiles and runs that exact source through /api/check/flow and
/api/run/flow, then sends its actual stdout values to persistent
base R (/api/run/r) for independent Fourier verification and to
persistent CPython (/api/run/python) for a separately implemented
4×4 matrix RK4 calculation. The gate checks all four values, replay,
conservation, error bounds, malformed compiler input, deliberately
inverted numerical assertions (HTTP 422), corrupted/truncated frames
(HTTP 422), R/Python recovery and Flow recovery. The request and
response ceilings are 128 KiB and 24 KiB. No random inputs or external
packages are required.

Independent source tests:

    python3 -m unittest discover -s tests -p test_native_heat2d_http_oracle.py -v

The real native acceptance requires the pinned Flow 2.0.0 toolchain
and Rscript, and is invoked by:

    python3 scripts/verify_native.py --require-r

It is mandatory in the existing Linux/macOS native CI jobs, alongside
the existing PDE, notebook, plotting and Ubuntu Chromium tests. The
source unit tests are not a substitute for the real compiler/HTTP gate.

Verification status must be taken from the exact PR-head CI run;
until that run completes, production execution is **unverified**.
Physical macOS Chromium is not part of this workflow. No hosted CI
workflow configuration was changed. Full RStudio parity remains open.
