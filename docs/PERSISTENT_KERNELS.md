# FlowStudio persistent Python/R kernels — integration patch (2026-10-16)

This patch integrates the existing, independently tested persistent interpreter transport into the Flow-native HTTP dispatcher. It also connects the existing allowlisted data-viewer asset routes. **Integration is not compiled or executed with Flow yet**: the validation host does not have the Flow compiler or R interpreter. Do not claim end-to-end RStudio parity.

## Architecture

`src/main.flow` owns HTTP routing and uses `src/kernel_session.flow` for Python/R sessions. The narrow `src/kernel_bridge.c` shim owns process groups, framed pipes and monotonic deadlines. `scripts/python_kernel.py` and `scripts/r_kernel.R` implement persistent evaluation and environment inspection. Flow source execution remains a separate one-shot subprocess.

Python and R have separate persistent process state, each with a 64 KiB source cap, 1 MiB output cap and 5-second per-command deadline. The process group is terminated on timeout; an explicit reset starts a new interpreter. Environment inspection returns up to 200 variables as JSON. A kernel is started lazily on first request, and stays alive until reset, timeout or server exit.

## HTTP routes

`POST /api/run/python` and `POST /api/run/r` now evaluate in persistent interpreters; `POST /api/run/flow` remains one-shot. `POST /api/inspect/python`, `POST /api/inspect/r`, `POST /api/reset/python` and `POST /api/reset/r` are added. All POST routes require the existing `X-FlowStudio-Intent: run` header and loopback-only Host/Origin checks. Syntax errors appear as response text; the current HTTP API returns status 200 for evaluation errors and does not yet expose structured per-evaluation error status. `GET /data`, `/data.html`, `/data_viewer.js`, `/data_page.js`, and `/index.html` use the explicit Flow route allowlist. The editor's environment panel is not yet wired to the new inspection routes.

## Validated locally on Linux x86-64

With GCC 14.2.0 and Python 3.13.5, from repository root:

    python3 tests/kernel_bridge.test.py -v
    python3 tests/integration_contract.test.py -v
    cc -std=c11 -Wall -Wextra -Werror -fsyntax-only src/kernel_bridge.c
    sh -n scripts/build.sh

Results: 12/12 native C/Python kernel tests passed, one R test skipped because R is unavailable; four static route/build contract tests passed. The C bridge passed strict C11 syntax checking. These results **do not** establish that Flow's native C generator compiles the integrated source.

## Remaining verification and security work

Install a compatible Flow compiler, run `sh scripts/build.sh`, start `./build/flowstudio` from repository root, then run `python3 tests/http_smoke.py` and `python3 tests/http_kernels_smoke.py`. Verify macOS arm64, Linux x86-64, real R session persistence, browser integration, timeout behaviour and error statuses. Link errors or Flow import/extern mismatches must be fixed before merging.

**Trusted local code only.** Kernel code executes with the server user's permissions. There is no sandbox, authentication, per-user isolation or remote execution support. Do not expose this service publicly or run it as root. Python/R programs can interfere with their own process protocol; a production server requires stronger isolation and lifecycle management.
