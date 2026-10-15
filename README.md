# FlowStudio

A **Flow-first scientific IDE** intended to become a capable successor to RStudio. Flow is the application/session language; R and Python are supported as external language runtimes.

**Current status:** early, unverified developer preview. This is **not** RStudio feature parity. Exact coverage and acceptance criteria are in [docs/PARITY.md](docs/PARITY.md).

## First executable slice

The initial implementation includes a native Flow server (src/main.flow), a small POSIX sockets/temp-file bridge (src/http_bridge.c), and a four-pane browser workspace (web/index.html).

The browser can open and save source files, run the selected text or whole buffer as Flow, R or Python, and display captured stdout/stderr. Python and R use a **fresh interpreter per execution**; these are not persistent notebook sessions.

## Build and launch

Requirements: [Flow 2.x](https://github.com/flooooooooooow/flow) installed as flow, a C11 compiler available as cc, POSIX macOS/Linux and a recent browser. Python 3 and R are optional **runtime executables** for their respective execution modes.

From the repository root:

    sh scripts/build.sh
    ./build/flowstudio

Open http://127.0.0.1:8751 in a browser. Press **Ctrl/⌘+Enter** to execute selected text or the whole document, and **Ctrl/⌘+S** to save. On browsers supporting the File System Access API, saves write back to the selected file. Other browsers use a downloaded file fallback.

For a running server, test the HTTP API and installed language runtimes:

    python3 tests/http_smoke.py

The build script performs a C syntax check, invokes Flow's documented C-generation compiler path and links the socket transport. These commands are provided for reproducibility; **no successful Flow compiler run is claimed in this initial commit** because the Flow toolchain is not installed in the authoring environment. Build and integration fixes are the highest-priority next milestone.

### Native transport regression tests

Stop any FlowStudio process already using port 8751, then run:

    python3 tests/transport_smoke.py

This builds the real POSIX transport with a small test-only router and exercises its request handling on loopback. It **does not require the Flow compiler** and **does not prove that FlowStudio itself builds**. The suite has 15 cases for Host/origin validation, request framing and size limits, and valid HTTP responses. On Linux x86-64 with GCC 14.2.0 and Python 3.13.5, all 15 passed on 15 October 2026.

## Architecture

    browser (HTML/CSS/JS)
             |
    localhost HTTP / text execution API
             |
    src/main.flow (routing / execution / subprocess lifecycle)
             |
    std.process  +  native POSIX socket bridge
             |
       Flow / R / Python

Current API: GET /, GET /health, POST /api/run/flow, POST /api/run/r and POST /api/run/python. POST sends UTF-8 source text and requires an X-FlowStudio-Intent: run request header. Each subprocess has a 15-second timeout and captured output. No shell command-string evaluation is used.

## Security and scope

**Code execution is not sandboxed.** Executed code has all the local permissions of the FlowStudio process; use trusted code only. The server binds to 127.0.0.1, rejects cross-origin browser execution and caps request size. Never expose this preview publicly or run it as root. A production remote service will require authenticated sessions and isolation before network exposure.

The native C shim is intentionally limited to OS-facing socket and temporary-file operations; program routing and language execution are in Flow.

## Licensing

This is a new independent codebase, not a translation of RStudio's AGPLv3 source. Flow itself has [separate licensing terms](https://github.com/flooooooooooow/flow/blob/main/LICENSE). No third-party RStudio source code is incorporated into this repository. A FlowStudio distribution licence has not yet been specified.
