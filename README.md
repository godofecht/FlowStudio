# FlowStudio

[![CI](https://github.com/godofecht/FlowStudio/actions/workflows/ci.yml/badge.svg)](https://github.com/godofecht/FlowStudio/actions/workflows/ci.yml)

**Version:** `0.1.0-alpha.1` (developer preview; canonical value in [`VERSION`](VERSION)). See [release notes](RELEASE_NOTES.md), [release packages](https://github.com/godofecht/FlowStudio/releases), and the [Pages documentation](https://godofecht.github.io/FlowStudio/). A preview package is published only after Linux and macOS CI gates qualify the same commit. Pages requires one-time repository configuration.

A **Flow-first scientific IDE** intended to become a capable successor to RStudio. Flow is the application/session language; R and Python are supported as external language runtimes.

**Current status:** early, unverified developer preview. This is **not** RStudio feature parity. Exact coverage and acceptance criteria are in [docs/PARITY.md](docs/PARITY.md).

## First executable slice

The initial implementation includes a native Flow server (src/main.flow), a small POSIX sockets/temp-file bridge (src/http_bridge.c), and a four-pane browser workspace (web/index.html).

The browser can open and save source files, choose a local project folder, lazily browse its source tree, create a source file in the project root, refresh the tree, search project files for literal text with exact match navigation, run the selected text or whole buffer as Flow, R or Python, and display captured stdout/stderr. Project operations use the browser File System Access API and are unavailable in browsers without folder-picker support. The native server retains separate Python and R interpreter processes between evaluations, with explicit reset controls. These are single-user localhost sessions, not restart-persistent or remotely isolated kernels.

### Editor find and replace

Use Ctrl/⌘+F to focus the in-buffer literal search, F3 / Shift+F3 for next/previous matches, and Ctrl/⌘+H to focus replacement. The source pane has Replace and Replace all controls, plus a case-sensitive option. Replacement text is literal (no regular-expression substitutions). Operations run locally in the browser; they never send the document to the execution API. The editor search is limited to 2 MiB and 10,000 matches; Replace all refuses to modify a truncated match set.

Run the additional pure-module tests with:

    node --test tests/editor_find.test.js

## Build and launch

Requirements: [Flow 2.x](https://github.com/flooooooooooow/flow) installed as flow, a C11 compiler available as cc, POSIX macOS/Linux and a recent browser. Python 3 and Rscript are optional **runtime executables** for their respective execution modes.

From the repository root:

    sh scripts/build.sh
    ./build/flowstudio

Open http://127.0.0.1:8751 in a browser. Press **Ctrl/⌘+Enter** to execute selected text or the whole document, and **Ctrl/⌘+S** to save. On browsers supporting the File System Access API, saves write back to the selected file. Other browsers use a downloaded file fallback.

For a running server, test the HTTP API and installed language runtimes:

    python3 tests/http_smoke.py

For browser-logic tests without a running server (Node.js 20+):

    node --test tests/project_browser.test.js tests/project_search.test.js tests/workspace_browser.test.js

The build script performs a C syntax check, invokes Flow's documented C-generation compiler path and links the socket transport. These commands are provided for reproducibility; **no successful Flow compiler run is claimed** because the Flow toolchain is not installed in the authoring environment. Build and integration fixes are the highest-priority next milestone.

### Native transport regression tests

Stop any FlowStudio process already using port 8751, then run:

    python3 tests/transport_smoke.py

This builds the real POSIX transport with a small test-only router and exercises its request handling on loopback. It **does not require the Flow compiler** and **does not prove that FlowStudio itself builds**. The suite has 15 cases for Host/origin validation, request framing and size limits, and valid HTTP responses. On Linux x86-64 with GCC 14.2.0 and Python 3.13.5, all 15 passed on 15 October 2026.

### Project search

Open a folder, enter a literal query under **Find in project**, and select **Find all**. Matches appear with file paths and line/column locations. Selecting a result opens that file and highlights the match. Unsaved editor changes are never silently discarded. Search reads browser-granted local handles only; it does not send project contents to the Flow server. Search limits are documented in the parity matrix.

## Versioned native packages

After a successful native build and acceptance test (`python3 scripts/verify_native.py`), run `sh scripts/package.sh` to create a platform-specific `.tar.gz` in `dist/`. The archive has `run.sh`, the compiled executable, web assets, docs, licence, README and VERSION. Its runtime must be run from its own extracted root; `flow` 2.x is an external runtime dependency for Flow execution. Release automation publishes Linux x86-64 and macOS arm64 archives plus a source archive and SHA256 checksums only after both CI platforms pass on `main`.

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

Current API: GET /, GET /health, POST /api/run/flow, POST /api/run/r, POST /api/reset/r, POST /api/run/python, POST /api/inspect/python and POST /api/reset/python. POST sends UTF-8 source text and requires an X-FlowStudio-Intent: run request header. Persistent Python and R sessions each have a 15-second evaluation timeout and explicit reset; Flow has a 60-second compile-and-run budget to accommodate cold compiler start. All processes have bounded, captured output. No shell command-string evaluation is used.

## Security and scope

**Code execution is not sandboxed.** Executed code has all the local permissions of the FlowStudio process; use trusted code only. The server binds to 127.0.0.1, rejects cross-origin browser execution and caps request size. Never expose this preview publicly or run it as root. A production remote service will require authenticated sessions and isolation before network exposure.

The native C shims handle OS-facing sockets, temporary files and framed interpreter IPC; Flow owns routing and session operations. Python and R evaluation are performed by their respective language runtimes.

## Licensing

This is a new independent codebase, not a translation of RStudio's AGPLv3 source. Flow itself has [separate licensing terms](https://github.com/flooooooooooow/flow/blob/main/LICENSE). No third-party RStudio source code is incorporated into this repository. The source and distributed preview are **all rights reserved**; see [LICENSE](LICENSE). External Flow, R and Python installations remain under their own terms.
