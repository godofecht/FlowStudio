# FlowStudio v0.2.0-alpha.3 developer preview

An experimental Flow-native localhost scientific IDE. This preview makes Flow
work the way R works in RStudio, and adds an AI assistant that edits in place.

## Flow console session

- Variables, functions, structs and imports persist between console entries.
  A bare expression prints its value.
- In a script without `main()`, Ctrl+Enter sends the statement or selection
  under the cursor and moves to the next one. A file with `main()` runs whole.
- An entry takes about half a second once the compiler is warm. Entries build
  at `-O0` through `src/flow_quick_run.sh`; Run still uses `flow run` at `-O2`.
- The Environment pane lists Flow variables. Arrays and structs open in the
  data grid, which sorts, filters and exports.
- Entries can call Python and R through `py()` and `r()`.

## Console

- A run reads as the command, then its output. A spinner shows while it runs,
  a red prompt marks a failure, and the time appears past one second.
- Compiler and runtime messages are cleaned: one located line per Flow error,
  no temporary paths or build logs, Python tracebacks without FlowStudio's
  own frames, marked R errors and warnings. The raw log stays behind Full log.
  On a Run, line numbers jump to the editor.

## Editor and language tools

- `flow lsp` drives completion, hover, go to definition, references, rename,
  formatting, quick fixes and diagnostics, across the files of a project and
  in scripts that use session variables.
- On a machine where `flow lsp` was never built, the first start compiles it.
  FlowStudio now waits for that build.
- Help pane: F1 on a Flow name, or search, shows its signature, comment and
  examples.
- Flow plots land in the Plots pane with history, zoom and SVG or PNG export.
- The Packages view runs `flow init`, adds and removes Flow dependencies.
- A C or MLIR backend menu shows whether MLIR is installed and remembers the
  choice per project.

## AI assistant

- Uses the installed Claude Code, Codex or Ollama with the user's own login.
  API key variables are removed from its environment.
- Cmd/Ctrl+K edits in place: the change streams in as an inline diff with
  Accept and Reject per change, and an accept is one undo step.
- Chat streams as it arrives. Code blocks have Apply, Copy, Insert and Run.
  The current file, selection and error go along as removable chips.
- Edits the agent proposes open as inline diffs with a review list per file.
- "Fix with Assistant" on Flow compiler errors.
- `claude` and `codex` started in the Terminal get the FlowStudio MCP tools
  without changes to global configuration.
- New projects carry `AGENTS.md`, `CLAUDE.md` and `.mcp.json`.
  `docs/FLOW_FOR_AI.md` is a Flow guide for agents whose examples are compiled
  by tests.

## Graphics Preview

- Builds run in their own process, so the IDE keeps answering during a build.
  The Preview shows the stage and elapsed time.
- FlowStudio keeps its own Emscripten cache, so the slow first build happens
  once per machine. Saving rebuilds; the dragged Preview width is kept per
  project.

## Fixes

- Check Flow resolves `import flowstudio` and marks the editor again.
- Check Flow and native runs work on any loopback port (`FLOWSTUDIO_PORT`).
- The Linux build declares `realpath`.
- A plot helper named `finite` clashed with glibc and broke every program that
  imported `flowstudio` on Linux.
- Debuggers accept a breakpoint update that arrives after the session ended.
- The release archive now holds every file the server opens at run time. The
  previous archive lacked the session helper, the Flow bridge module, the
  Flow debugger and the MCP server.

## Known limits

- Values the session cannot rebuild (pointers, lists, maps, nested arrays,
  arrays over 4,096 items) are listed as not kept.
- CI has no `emcc`, so Preview checks run on macOS only. CI's Linux runner has
  no MLIR.
- The assistant suites use a fake command line tool. Claude Code passed one
  live run and Codex one manual run on macOS. Ollama was not run.

## Package

Extract and run `./run.sh`. Requires Flow 2.0 as `flow`; Python 3 and R are
optional. The server binds to localhost, port 8751 by default. This is not a
sandbox: do not expose the server or run untrusted code.

## Prior release

# FlowStudio v0.2.0-alpha.2 developer preview

An experimental Flow-native localhost scientific IDE with an HTML workspace.

Unreleased working-set addition: the native workspace console was rebuilt as
an integrated developer terminal. It has runtime tabs with explicit per-runtime
sessions, an honest status row (unknown/running/ready/failed/disconnected,
with "shared interpreter" labeling for Python and R), a syntax-highlighted
prompt that lives inline as the next transcript line, history recall,
in-panel transcript search (Ctrl+F), Ctrl+L clear, per-command timestamps and
durations, an overflow menu holding opt-in device history, per-runtime
history clearing and a two-step Python/R interpreter reset, and inline
rendering of captured R/Python figures. Execution still uses the same
Flow-owned localhost routes, headers and busy-locks; no execution behavior
was simulated. Verification so far: the Node suite (1022 tests) passes,
assets are served by the rebuilt native binary, and a live Chromium session
exercised real Python execution, the failure path, tab isolation and the
editor round-trip on macOS arm64 with screenshots.

The preview adds, since v0.2.0-alpha.1: an examples gallery whose curated projects open and run in one click, automatically landing captured figures in the Plots tab; native R plot capture that prefers the cairo SVG device (rendered directly as a browser image) with a PDF fallback and a per-build device probe; a consent-gated native Quarto render through the installed `quarto` CLI producing bounded standalone HTML reports; mathematical Flow compilation of typed boundary conditions (constant Dirichlet, Neumann flux and Robin heat-transfer cases) with unicode spatial derivatives and combined reaction and diffusion forcing, plotting heatmaps and velocity fields; browser session snapshots that round-trip NumPy ndarray dtypes, plain R matrices and R data.frame factor columns through the real Pyodide/webR workers; R factor-column persistence parity through the live webR session and real Rscript acceptance; and an offline Flow language help reference served through the native asset allowlist without interpreter execution. This release also fixes an R kernel startup crash where the plot capture probe referenced `grDevices::capabilities` (which is not exported from that namespace) that halted every R request on R 4.6.1.

Each feature landed through its own CI qualification and parity documentation; integration and verification levels vary feature by feature, see docs/PARITY.md. Verified live on macOS arm64 during this release cycle: real R 4.6.1 execution produces captured SVG figures that render in the Plots tab over the native HTTP server, and the native R IPC harness (`tests/test_native_r_session.py`) exercises real persistent `Rscript` sessions including plot capture.

## Package

Same packaging terms as the previous preview: packages contain a verified native executable and checked-in web/docs assets. Extract and run `./run.sh` from the unpacked package root. Requires an installed Flow 2.0 runtime/compiler available as `flow` for Flow code execution; Python 3 and R are optional external runtimes. Package installs through the packages panel require pip and CRAN connectivity on the host (no mirror is bundled or vendored). The preview uses localhost port 8751. Native builds target Linux x86-64 and macOS arm64. Packages do not embed the Flow compiler, R or Python. The Quarto render feature requires the host `quarto` CLI and is strictly consent-gated; it is absent where the CLI is missing.

## Safety and limitations

This is **not RStudio feature parity** and **not a sandbox**. Do not expose the HTTP server publicly or execute untrusted code. The browser file picker is subject to host/browser support. The Python replay debugger exposes bounded builtin-scalar locals only, records at most 256 trace events, and does not pause live execution. Package install specs are validated in the browser but install through real `pip`/`install.packages()` with full host privileges, so never point the server at untrusted input. Native Git and notebook export features inspect and write only inside the server's working tree. The native Quarto render spawns the host `quarto` CLI only after explicit user consent and stays bounded in time; nested executable fences and metadata shortcodes are rejected at the render boundary. Browser session snapshot acceptance runs are opt-in and marked as pending where not independently executed; check docs/PARITY.md and docs/PHYSICAL_BROWSER_ACCEPTANCE.md per feature. Python and R executions are capped at 15 seconds; Flow compile-and-run executions are capped at 60 seconds to account for a cold compiler. The release qualification gate compiles the real Flow router on both platforms and runs live HTTP smoke and R kernel acceptance; it does not certify all user-interface and RStudio parity features.

Versioned archives and SHA256SUMS are published only after all configured cross-platform CI jobs pass. Code remains independently implemented, without RStudio source. No npm packages are bundled with the native transport; DOMPurify, esbuild, lucide, monaco-editor and playwright ship only in the node development tree.

## Prior release

# FlowStudio v0.2.0-alpha.1 developer preview

An experimental Flow-native localhost scientific IDE with an HTML workspace.

The preview adds a terminal-style native workspace console (ANSI styling,
styled error and prompt classes, bounded keeper buffer), a packages panel
driven by the real persistent pip and R sessions (pinned pip specs allowed,
R installs from the CRAN cloud mirror), an examples gallery featuring
curated Flow + Python + R interoperability projects, a Python replay
debugger with editor breakpoints over the real CPython line trace
(`/api/trace/python`), and workbench completion combining lexical Flow
symbols with live Python/R session variables. Running Flow with the MLIR
backend selected uses the real Flow compiler (`--backend=mlir`) over
`POST /api/run/flow-mlir`; the default backend remains the documented C
path. This is an execution replay tracer, not a live pause/resume debugger;
it is Python-only, and Flow/R tracing remains missing. Integration and
verification levels vary; see README.md and docs/PARITY.md.

Verified live against the real Flow compiler on macOS arm64: `/api/run/flow-mlir`
produced the full FLOW → MLIR → LLVM → executable pipeline and program
output; the same program via `/api/run/flow` used the FLOW → C path. The
qualification gate compiles and runs the real Flow router, HTTP smoke and
native execution before any package is uploaded; missing required
compilers/builds fail CI.

## Package

This version also consolidates the following native capabilities verified on main (see docs/PARITY.md for cross-platform status): interactive CPython breakpoint debugging with step-through and conditional breakpoints; Flow-owned native R top-level stepping, breakpoints and postmortem call stacks; native R package install/inspect/load/update/remove, syntax diagnostics, PDF plots, table previews and CSV export; native Git status, staging, commit, selective unstage and branch management; portable FlowStudio notebooks with Jupyter and R Markdown import/export; project-wide regex search and previewed replacement with undo; editor F12 go-to-definition, Shift+F12 references and F2 rename; bounded Python/R session snapshots and typed variable transfer; and offline HTML report export for mixed-language notebooks.

Packages contain a verified native executable and checked-in web/docs assets. Extract and run `./run.sh` from the unpacked package root. Requires an installed Flow 2.0 runtime/compiler available as `flow` for Flow code execution; Python 3 and R are optional external runtimes. Package installs through the packages panel require pip and CRAN connectivity on the host (no mirror is bundled or vendored). The preview uses localhost port 8751. Native builds target Linux x86-64 and macOS arm64. Packages do not embed the Flow compiler or R/Python.

## Safety and limitations

This is **not RStudio feature parity** and **not a sandbox**. Do not expose the HTTP server publicly or execute untrusted code. The browser file picker is subject to host/browser support. The Python replay debugger exposes bounded builtin-scalar locals only, records at most 256 trace events, and does not pause live execution. Package install specs are validated in the browser but install through real `pip`/`install.packages()` with full host privileges, so never point the server at untrusted input. Native Git and notebook export features inspect and write only inside the server's working tree. Python and R executions are capped at 15 seconds; Flow compile-and-run executions are capped at 60 seconds to account for a cold compiler. The release qualification gate compiles the real Flow router on both platforms and runs live HTTP smoke; it does not certify all user-interface and RStudio parity features.

Versioned archives and SHA256SUMS are published only after all configured cross-platform CI jobs pass. Code remains independently implemented, without RStudio source. No npm packages are bundled with the native transport; DOMPurify, esbuild, lucide, monaco-editor and playwright ship only in the node development tree.

## Prior releases

# FlowStudio v0.1.0-alpha.1 developer preview

An experimental Flow-native localhost scientific IDE with an HTML workspace.

The preview includes a Flow-owned HTTP router, a POSIX transport, a four-pane editor, browser-mediated project file operations, source search/replace, source cells, an interactive console, basic plotting/data viewer modules, and Flow/R/Python subprocess execution. These features have varying levels of integration and verification; see docs/PARITY.md.

## Package

Packages contain a verified native executable and checked-in web/docs assets. Extract and run `./run.sh` from the unpacked package root. Requires an installed Flow 2.0 runtime/compiler available as `flow` for Flow code execution; Python 3 and R are optional external runtimes. The preview uses localhost port 8751. Native builds target Linux x86-64 and macOS arm64. Packages do not embed the Flow compiler or R/Python.

## Safety and limitations

This is **not RStudio feature parity** and **not a sandbox**. Do not expose the HTTP server publicly or execute untrusted code. The browser file picker is subject to host/browser support. R/Python currently start fresh processes rather than persistent interpreter sessions. Python and R executions are capped at 15 seconds; Flow compile-and-run executions are capped at 60 seconds to account for a cold compiler. The release qualification gate compiles the real Flow router on both platforms and runs live HTTP smoke; it does not certify all user-interface and RStudio parity features.

Versioned archives and SHA256SUMS are published only after all configured cross-platform CI jobs pass. Code remains independently implemented, without RStudio source.
