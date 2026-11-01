# Native 3D Flow / R / Python HTTP parity acceptance

This regression uses the production Flow 2.0 compiler and FlowStudio localhost
HTTP router, not a mocked interpreter or an offline substitute.

The existing checked-in examples/native_coupled_volume8.flow compiles and
executes an 8×8×8, two-species, periodic anisotropic diffusion/exchange system.
Its seed-9137 final output contains **1,024 computed voxel values**. The new
examples/coupled_volume8_r.R evolves the same non-Fourier initial fields with
an independent vectorized base-R neighbor-gather implementation. It checks
every step's mass, maximum principle and centered spatial energy, plus
deterministic replay and a 32+32 checkpoint/restart.

tests/http_volume8_interop.py receives the **actual Flow response** from
tests/http_smoke.py, checks R against Flow and the existing independent Python
sparse Markov oracle, then sends the complete R output and all 64 energy
samples to the persistent production /api/run/python kernel. That kernel
reconstructs a separate explicit 3D stencil with Python standard-library
arithmetic. It must reject a finite corrupted voxel, a corrupted intermediate
energy and a truncated result with HTTP 422. The real R kernel must reject an
unstable coefficient without changing its persistent completed state; both
kernels must remain usable after errors.

The tests are deterministic, use no random global state, and enforce 128 KiB
source and 40 KiB R response limits. R is base-only; the Python kernel requires
no NumPy. All 64 steps remain within the 262,144 species-voxel-step budget.

Run the source/oracle tests:

    python3 -m unittest discover -s tests -p 'test_volume8_interop_source.py' -v

Run the complete real native Flow, R, Python and HTTP acceptance (requires Flow
v2.0.0, R, native compiler toolchain and Node):

    python3 scripts/verify_native.py --require-r

The existing Linux/macOS CI runs that command and separately executes physical
Ubuntu Chromium acceptance. A passing source test alone does not establish
native HTTP or browser success. This verifies cross-runtime 3D numerical
agreement, **not** compiler-generated multidimensional field lowering,
general PDE grammar or complete RStudio parity.
