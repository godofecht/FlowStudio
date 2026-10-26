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

Packages contain a verified native executable and checked-in web/docs assets. Extract and run `./run.sh` from the unpacked package root. Requires an installed Flow 2.0 runtime/compiler available as `flow` for Flow code execution; Python 3 and R are optional external runtimes. Package installs through the packages panel require pip and CRAN connectivity on the host (no mirror is bundled or vendored). The preview uses localhost port 8751. Native builds target Linux x86-64 and macOS arm64. Packages do not embed the Flow compiler or R/Python.

## Safety and limitations

This is **not RStudio feature parity** and **not a sandbox**. Do not expose the HTTP server publicly or execute untrusted code. The browser file picker is subject to host/browser support. The Python replay debugger exposes bounded builtin-scalar locals only, records at most 256 trace events, and does not pause live execution. Package install specs are validated in the browser but install through real `pip`/`install.packages()` with full host privileges, so never point the server at untrusted input. Python and R executions are capped at 15 seconds; Flow compile-and-run executions are capped at 60 seconds to account for a cold compiler. The release qualification gate compiles the real Flow router on both platforms and runs live HTTP smoke; it does not certify all user-interface and RStudio parity features.

Versioned archives and SHA256SUMS are published only after all configured cross-platform CI jobs pass. Code remains independently implemented, without RStudio source. No npm packages are bundled with the native transport; DOMPurify, esbuild, lucide, monaco-editor and playwright ship only in the node development tree.

## Prior release

# FlowStudio v0.1.0-alpha.1 developer preview

An experimental Flow-native localhost scientific IDE with an HTML workspace.

The preview includes a Flow-owned HTTP router, a POSIX transport, a four-pane editor, browser-mediated project file operations, source search/replace, source cells, an interactive console, basic plotting/data viewer modules, and Flow/R/Python subprocess execution. These features have varying levels of integration and verification; see docs/PARITY.md.

## Package

Packages contain a verified native executable and checked-in web/docs assets. Extract and run `./run.sh` from the unpacked package root. Requires an installed Flow 2.0 runtime/compiler available as `flow` for Flow code execution; Python 3 and R are optional external runtimes. The preview uses localhost port 8751. Native builds target Linux x86-64 and macOS arm64. Packages do not embed the Flow compiler or R/Python.

## Safety and limitations

This is **not RStudio feature parity** and **not a sandbox**. Do not expose the HTTP server publicly or execute untrusted code. The browser file picker is subject to host/browser support. R/Python currently start fresh processes rather than persistent interpreter sessions. Python and R executions are capped at 15 seconds; Flow compile-and-run executions are capped at 60 seconds to account for a cold compiler. The release qualification gate compiles the real Flow router on both platforms and runs live HTTP smoke; it does not certify all user-interface and RStudio parity features.

Versioned archives and SHA256SUMS are published only after all configured cross-platform CI jobs pass. Code remains independently implemented, without RStudio source.
