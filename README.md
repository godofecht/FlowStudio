# FlowStudio

[![CI](https://github.com/godofecht/FlowStudio/actions/workflows/ci.yml/badge.svg)](https://github.com/godofecht/FlowStudio/actions/workflows/ci.yml)

**Version:** `0.2.0-alpha.2` (developer preview; canonical value in [`VERSION`](VERSION)). See [release notes](RELEASE_NOTES.md), [release packages](https://github.com/godofecht/FlowStudio/releases), and the [hosted documentation site](https://godofecht.github.io/FlowStudio/). A preview package is published only after Linux and macOS CI gates qualify the same commit. The static site is published from `docs/` by `.github/workflows/pages.yml` only after CI passes on `main`.

A **Flow-first scientific IDE** intended to become a capable successor to RStudio. Flow is the application/session language; R and Python are supported as external language runtimes.

**Current status:** early, unverified developer preview. This is **not** RStudio feature parity. Exact coverage and acceptance criteria are in [docs/PARITY.md](docs/PARITY.md).

## First executable slice

The initial implementation includes a native Flow server (src/main.flow), a small POSIX sockets/temp-file bridge (src/http_bridge.c), and a tabbed browser workspace (web/index.html) with a menu bar, one tab per open document (unsaved markers, close controls, Ctrl/⌘+Tab cycling), a resizable project sidebar, an environment panel and a console dock.

### Workbench UI development

The native workspace uses Monaco Editor and Lucide icons. Editor assets and its
worker are bundled locally in `web/ui/`; opening the IDE needs no editor CDN.
The Pages demo in `docs/app/` has a separate frontend.

To rebuild the checked-in UI assets:

```sh
npm ci
npm run build:ui
```

UI sources live in `frontend/`. Each open document has a Monaco model for undo
history and cursor state. Ctrl+K opens the command menu. Flow syntax coloring is
lexical; it does not provide compiler diagnostics or a language server.

Run `npm test` for module tests and `python3 scripts/verify_native.py` for the real
Flow build and HTTP checks. With the native server running, `npm run test:ui`
exercises the Monaco workspace in headless Chromium. Install its browser with
`npx playwright install chromium`. Captures go in `build/ui/`.

The native build and HTTP checks pass locally. Browser verification remains
pending because the local browser processes fail before loading the workspace.

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

Press **F12** with the caret on a Flow, R or Python identifier to navigate to
its declaration in the active buffer. If absent, FlowStudio checks other
already-open same-language tabs and switches only when there is exactly one
match. The lookup is lexical and conservative, not semantic: imports,
members, local bindings and unopened files are not resolved. It never executes
source or reads additional files.

Run its tests with:

    node --test tests/ide_symbols.test.js tests/ide_outline.test.js tests/ide_definition.test.js

The browser can open several source files at once as tabs, save them, choose a local project folder, lazily browse its source tree, create a source file in the project root, refresh the tree, search project files for literal text with exact match navigation, run the selected text or whole buffer as Flow, R or Python, and display captured stdout/stderr. Project operations use the browser File System Access API and are unavailable in browsers without folder-picker support. The native server retains separate Python and R interpreter processes between evaluations, with explicit reset controls. These are single-user localhost sessions, not restart-persistent or remotely isolated kernels.

### Editor find and replace

Use Ctrl/⌘+F to focus the in-buffer literal search, F3 / Shift+F3 for next/previous matches, and Ctrl/⌘+H to focus replacement. The source pane has Replace and Replace all controls, plus a case-sensitive option. Replacement text is literal (no regular-expression substitutions). Operations run locally in the browser; they never send the document to the execution API. The editor search is limited to 2 MiB and 10,000 matches; Replace all refuses to modify a truncated match set.

Run the additional pure-module tests with:

    node --test tests/editor_find.test.js

## Terminal console, packages, examples, debugger (native workspace)

The native workspace console is a full terminal, not a form: runtime tabs
(Flow, Python, R, plus explicit `+` sessions), a compact status row that only
reports states the server actually produced (unknown at start, running,
ready, failed, disconnected; Python/R say "shared interpreter" because they
really do share the persistent kernel), an integrated syntax-highlighted
prompt (`flow ❯` / `python ❯` / `r ❯`) that sits inline as the next line of
the transcript, history up/down recall bound to per-session drafts,
Transcript search (Ctrl+F inside the panel), clear visible output (Ctrl+L),
streaming timestamps and per-command durations, and an overflow menu holding
the opt-in device history flag, per-runtime history clearing and a two-step
destructive Python/R interpreter reset (Flow has no interpreter to reset and
the menu says so). Captured R/Python figures render inline as figures and
stay in the Plots panel. The session menu also downloads the selected
scrollback as a bounded, ANSI-stripped UTF-8 transcript (.txt), including
timestamps and figure placeholders but not image bytes or other session tabs.
This is an explicit local download, not automatic persistence; transcripts may
contain commands, output and secrets. Execution still goes through the Flow-owned
localhost routes with the same headers and busy-locks as before; nothing was
fabricated on top of the real kernels. The standalone `/console` page keeps
its simpler form-based layout for scripting and accessibility use.

**Flow MLIR backend.** The topbar has a **Backend** selector (next to
Runtime). Running a Flow buffer with Backend set to MLIR sends the source
to the real `flow` process with `--backend=mlir`; the default backend keeps
the documented C path. The server exposes this as
`POST /api/run/flow-mlir` and always returns the compiler's own stdout and
stderr. A Flow build without LLVM shows exactly that error. Verified live
against the real compiler on macOS arm64 (see below for both pipelines).

**Packages tab.** A sidebar tab installs and lists real packages through
the persistent local sessions: pip (`pip install --user`, pinned
`name==version` specs allowed) and R `install.packages(...)` from the CRAN
cloud mirror. Specs are validated in the browser before any request; the
local 15 s per-session execution budget applies to installs.

**Examples tab.** Curated local examples show Flow, Python and R working in
one project: a Python → data-file → R pipeline, a stats-in-Python/visuals-in-R
pair, a one-shot Python → R handshake through `POST /api/demo/python-r`, and
a Flow example meant to run with the MLIR backend. "Open" adds each file to
the editor with the right language.

**Debug tab (Python replay tracer).** Toggle breakpoints at the cursor
(per buffer), run the real CPython line trace (`POST /api/trace/python`,
@traced by the persistent kernel) and scrub recorded states: click a step to
jump the caret to that line and read the bounded locals captured there.
Only builtin scalar values are previewed; complex values show type only.
This is an execution replay, not a live pause/resume kernel debugger, and
it is Python-only: Flow and R tracing remain missing.

**Completion.** The Monaco workbench merges lexical Flow symbols (same
bounded scanner as the Pages editor), live Python/R session variable names
(refreshed on a short TTL after runs) keywords and snippets. Suggestions
are editable-text inserts only: no signature help, members or LSP.

Tests:

    node --test tests/terminal_render.test.js tests/workspace_console.test.js \
      tests/packages_panel.test.js tests/examples_gallery.test.js \
      tests/debug_panel.test.js tests/ide_completion_core.test.js \
      tests/workspace_panels_contract.test.js

Live acceptance run on macOS arm64 26 October 2026 with Flow 2.x + LLVM:
`/api/run/flow-mlir` produced the full FLOW → MLIR → LLVM → executable
pipeline and program output; the same program on `/api/run/flow` used the
FLOW → C path. `python3 scripts/verify_native.py` passes for the native
build and HTTP smoke; native R persistence was skipped locally because
`Rscript` is not installed on the verification machine.

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

## Browser R named-list completion

In the `docs/app/` editor, select browser webR or native R and type a named
ordinary-list member access such as `analysis$model$sc`, then press
**Ctrl/⌘+Space**. Suggestions come from the selected **real R session's
existing environment inspection**, which is only inspected and never
executed.
Selecting `score` inserts only that member. A trailing `$` lists the
inspected names, including nested lists to the inspector's two-level limit.

The native R path still uses the Flow-owned loopback server. Only the first
twelve children per list and syntactically safe unquoted names are offered.
Class methods, data-frame columns, active bindings and uninspected members
are not guessed. The underlying R inspector may force lazy promises; do not
treat inspection as a sandbox. This is separate from the generated native
Monaco workbench, whose member-completion bundle is pending.

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

### Run notebook through the caret

In the browser workspace, **Run through here** executes every notebook code
cell from the beginning through the cell containing the caret, in source order,
through the existing Flow, Python and R execution backends. Markdown is
rendered but never evaluated; cells after the caret are not run. The existing
**Run from here** action executes the opposite range. The bounded notebook
runner validates the selected range before invoking any kernel, and stops on
the first error. Flow still requires the native localhost server. This is
not an RStudio-compatible kernel debugger or a guarantee of physical-browser
acceptance.

## Native Python source debugging

The Flow-owned localhost server now has an experimental interactive CPython
debugger. Enter comma-separated breakpoint line numbers in the browser's
Python debugger panel, then Start, Step into, Step over, Step out, Continue or Stop. An empty breakpoint
list stops on the first executable line. The stack viewer shows bounded local
variable types and safe scalar previews. Debugging executes real Python in
the existing persistent native session; it does not emulate breakpoints in
JavaScript. Step over skips source callees unless a breakpoint is hit; Step out resumes at the caller or completes a top-level frame. Ordinary native Python execution is blocked while the debugger
is active. The kernel runs with the current user's permissions and is not
safe for untrusted code. GitHub Pages, R and Flow source debugging are not
supported. See [docs/PARITY.md](docs/PARITY.md) for verification status.

## Native Git branches

The Git pane on the Flow-owned localhost server lists local branches, creates
a named branch at `HEAD`, switches to an existing local branch and offers
explicitly confirmed, non-forcing deletion of merged local branches. Git's
`branch -d` protects checked-out and unmerged branches; force deletion is
not exposed. Branch switching refuses tracked changes and non-ignored
untracked files; it never automatically stashes, commits, discards or
overwrites user work. Native Git commands use fixed argv, bounded timeouts
and disabled hooks. GitHub Pages has no access to the server working tree,
and a browser-picked project directory is not the Git target. Remote
tracking, merges and rebases are not implemented. Existing native Flow/HTTP
branch list/create/switch acceptance passed on Ubuntu and macOS in
[CI #40117614745](https://github.com/godofecht/FlowStudio/actions/runs/40117614745);
new deletion acceptance passed real Git/HTTP tests on Ubuntu and macOS in
[CI #40748505934](https://github.com/godofecht/FlowStudio/actions/runs/40748505934);
physical-browser interaction remains unverified. See [parity matrix](docs/PARITY.md).

`node --test tests/browser_git_native.test.js tests/browser_git_panel.test.js`
tests the browser-facing contract; `python3 scripts/verify_native.py`
builds the Flow server and exercises real Git operations over localhost
against an isolated temporary repository.

## Agent tools (MCP stdio server)

Agents (Claude Code, MCP-compatible clients) can drive this FlowStudio
install through a small stdio MCP server that proxies the native loopback
HTTP API with the same guarded `X-FlowStudio-Intent` requests. It supports
newline-delimited and LSP-style `Content-Length` framing, and answers:

- `flowstudio_run_code` compiles and runs Flow (default C path, or the
  real FLOW to MLIR to LLVM pipeline via the `mlir` language value),
  Python or R through the real server routes.
- `flowstudio_check_code` runs the strict Flow-to-C emit check without
  execution.
- `flowstudio_read_workspace_file` and `flowstudio_write_workspace_file`
  give bounded workspace file access.
- `flowstudio_flow_help` serves offline Flow 2.0.0 language reference
  entries.
- `flowstudio_health` is a server readiness probe.

Running tool calls execute unsandboxed local code, exactly as the native
server does; do not aim the server at untrusted input. The server prints
JSON-RPC to stdout only and binds nothing to a port.

    python3 mcp/flowstudio_mcp.py

Register it in an MCP client as command `python3` with arg
`mcp/flowstudio_mcp.py` (set `FLOWSTUDIO_URL` only if the native server
listens somewhere other than 127.0.0.1:8751). Contract tests that also
verify against a live server:

    python3 tests/mcp_server.test.py

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

## Experimental native R acceleration

An opt-in, guarded **FlowJIT** arithmetic-kernel prototype is available in the
persistent R session. `flowjit_compile(function(x) x * x + 1.0)` creates a
hotness-triggered GNU R C-toolchain specialization for plain double vectors,
with strict numeric inputs and a byte-compiled R fallback. Use
`flowjit_status()` to inspect real native invocations. This is **not** an
automatic replacement R compiler, nor does it presently emit Flow code.
See [scope, semantics and native acceptance](docs/FLOWJIT.md).

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

Current API: GET /, GET /health, POST /api/run/flow, POST /api/run/flow-mlir, POST /api/check/flow, POST /api/run/r, POST /api/reset/r, POST /api/inspect/r, POST /api/run/python, POST /api/trace/python, POST /api/inspect/python, POST /api/demo/python-r and POST /api/reset/python. POST sends UTF-8 source text and requires an X-FlowStudio-Intent: run request header. Persistent Python and R sessions each have a 15-second evaluation timeout and explicit reset; Flow has a 60-second compile-and-run budget to accommodate cold compiler start. All processes have bounded, captured output. No shell command-string evaluation is used.

## Security and scope

**Code execution is not sandboxed.** Executed code has all the local permissions of the FlowStudio process; use trusted code only. The server binds to 127.0.0.1, rejects cross-origin browser execution and caps request size. Never expose this preview publicly or run it as root. A production remote service will require authenticated sessions and isolation before network exposure.

The native C shims handle OS-facing sockets, temporary files and framed interpreter IPC; Flow owns routing and session operations. Python and R evaluation are performed by their respective language runtimes.

## Licensing

This is a new independent codebase. It is not a translation of RStudio's AGPLv3 source. Flow itself has [separate licensing terms](https://github.com/flooooooooooow/flow/blob/main/LICENSE). No third-party RStudio source code is incorporated into this repository. The source and distributed preview are **all rights reserved**; see [LICENSE](LICENSE). External Flow, R and Python installations remain under their own terms.
