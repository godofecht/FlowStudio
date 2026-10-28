# FlowStudio v0.2.0-alpha.2 developer preview

An experimental Flow-native localhost scientific IDE with an HTML workspace.

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
