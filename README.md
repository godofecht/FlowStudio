# FlowStudio

[![CI](https://github.com/godofecht/FlowStudio/actions/workflows/ci.yml/badge.svg)](https://github.com/godofecht/FlowStudio/actions/workflows/ci.yml)

**Version:** `0.1.0-alpha.1` (developer preview; canonical value in [`VERSION`](VERSION)). See [release notes](RELEASE_NOTES.md), [release packages](https://github.com/godofecht/FlowStudio/releases), and the [hosted documentation site](https://godofecht.github.io/FlowStudio/). A preview package is published only after Linux and macOS CI gates qualify the same commit. The static site is published from `docs/` by `.github/workflows/pages.yml` only after CI passes on `main`.

A **Flow-first scientific IDE** intended to become a capable successor to RStudio. Flow is the application/session language; R and Python are supported as external language runtimes.

**Current status:** early, unverified developer preview. This is **not** RStudio feature parity. Exact coverage and acceptance criteria are in [docs/PARITY.md](docs/PARITY.md).

## First executable slice

The initial implementation includes a native Flow server (src/main.flow), a small POSIX sockets/temp-file bridge (src/http_bridge.c), and a tabbed browser workspace (web/index.html) with a menu bar, one tab per open document (unsaved markers, close controls, Ctrl/⌘+Tab cycling), a resizable project sidebar, an environment panel and a console dock.

### Document outline

An **Outline** workspace tab lists the symbols of the active buffer for Flow
(functions, structs, enums, module bindings), Python (classes, methods,
functions, module constants with nesting depth) and R (functions, R6/S4 classes,
top-level bindings). Selecting a symbol moves the caret to its line and scrolls
it into view, and **Ctrl/⌘+Shift+O** (Edit ▸ Go to symbol) focuses the outline
directly. Extraction is a bounded, best-effort line scan in the browser: it does
not parse the language, skips lines over 400 characters, reports at most 400
symbols, and never sends buffer text to the server. The outline re-reads the
buffer 250 ms after typing stops and whenever the active document changes.

Run its tests with:

    node --test tests/ide_symbols.test.js tests/ide_outline.test.js

The browser can open several source files at once as tabs, save them, choose a local project folder, lazily browse its source tree, create a source file in the project root, refresh the tree, search project files for literal text with exact match navigation, run the selected text or whole buffer as Flow, R or Python, and display captured stdout/stderr. Project operations use the browser File System Access API and are unavailable in browsers without folder-picker support. The native server retains separate Python and R interpreter processes between evaluations, with explicit reset controls. These are single-user localhost sessions, not restart-persistent or remotely isolated kernels.

### Editor find and replace

Use Ctrl/⌘+F to focus the in-buffer literal search, F3 / Shift+F3 for next/previous matches, and Ctrl/⌘+H to focus replacement. The source pane has Replace and Replace all controls, plus a case-sensitive option. Replacement text is literal (no regular-expression substitutions). Operations run locally in the browser; they never send the document to the execution API. The editor search is limited to 2 MiB and 10,000 matches; Replace all refuses to modify a truncated match set.

Run the additional pure-module tests with:

    node --test tests/editor_find.test.js

## Independent Python/R/Flow console (browser workspace)

The `docs/app/` workspace has a **Console language** selector separate from the
source editor's language. Python submissions run in the same persistent Pyodide
worker as Python source cells, and R submissions run in the same persistent
webR session as R cells. Flow console submissions run full Flow programs through
the real native Flow-owned `/api/run/flow` endpoint **only** when the workspace
is served at `http://127.0.0.1:8751/app/`; GitHub Pages cannot compile Flow.
Flow is compiled afresh for each submission and has no persistent Flow REPL
variables. Switching console language preserves unsent drafts and bounded
100-entry command histories independently for each language. Runtime errors
preserve console input for correction; successful submissions clear it.
The Reset button targets the **source editor's** selected Python/R runtime;
Flow has no session to reset. No interpreter variables persist across reloads.

The console dispatch, history, drafts and pending-submission behavior have
Node regression tests. Physical-browser interaction with live Pyodide/webR
and native Flow execution remains unverified.

`node --test tests/browser_console_repl.test.js tests/browser_console_multilanguage.test.js tests/browser_console_repl_integration.test.js`

## Flow source-local symbol completion

The GitHub Pages editor and native-served `/app/` editor also support
**Ctrl+Space** for Flow source-local identifiers without executing code or
requiring a Python/R runtime. Completion scans bounded Flow source (256 KiB)
for functions, types, explicit imports, parameters and currently open lexical
`let` scopes. Comments and quoted strings are excluded, and results are
limited to 64 names. This is an editor convenience, **not** semantic completion:
it does not resolve imports transitively, infer types, offer members, or replace
the actual `flowc --strict` diagnostics. No Flow execution occurs on GitHub Pages.

`node --test tests/browser_flow_completion.test.js tests/browser_completion.test.js`
checks real Flow syntax fixtures and editor insertion.

## Browser Python/R symbol completion

The GitHub Pages workspace and native-served `/app/` editor support
**Ctrl+Space** or **Complete Ctrl+Space** to list real Python and R symbol
names from the current interpreter session. Python names come from Pyodide's
globals and builtins; R names come from the active webR search path. Choose
a suggestion with keyboard Tab/Enter or click to insert it into the source
editor. The request does not evaluate the prefix or run user expressions.
Results are capped at 64 names and stale responses are ignored.

This is identifier-prefix completion only: member/attribute completion,
Flow completion, function signatures and LSP integration remain missing.
The legacy native `web/index.html` editor does not yet expose this UI.
Runtime acceptance in physical browsers is pending; see
`docs/PARITY.md`.

## Sequential Flow notebooks (native server)

The browser workspace at `http://127.0.0.1:8751/app/` can now run all
`# %%`-delimited **Flow** cells, alongside the existing Python and R notebook
execution. Select **Flow**, put a complete, independently executable Flow
program (including `function main() -> i32`) in each code cell, and choose
**Run all cells**. Cells are compiled and executed in order using the real
Flow-owned `/api/run/flow` route; execution stops at the first compiler or
runtime error. Markdown cells are displayed without execution. Bounded text
outputs can be recovered from browser storage after reload, but execution
state is not recovered.

Unlike persistent Python and R notebooks, **Flow cells run as independent
compiled programs**: declarations and variables do not persist between cells.
GitHub Pages cannot execute Flow because it cannot run the native compiler;
the hosted editor continues to execute Python/R through browser WebAssembly.
Flow notebooks are not yet supported by the Python/R-only Jupyter export or
HTML report exporter. Physical-browser end-to-end acceptance remains pending.

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
