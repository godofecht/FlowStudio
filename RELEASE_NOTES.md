# FlowStudio v0.1.0-alpha.1 — developer preview

An experimental Flow-native localhost scientific IDE with an HTML workspace.

The preview includes a Flow-owned HTTP router, a POSIX transport, a four-pane editor, browser-mediated project file operations, source search/replace, source cells, an interactive console, basic plotting/data viewer modules, and Flow/R/Python subprocess execution. These features have varying levels of integration and verification; see docs/PARITY.md.

## Package

Packages contain a verified native executable and checked-in web/docs assets. Extract and run `./run.sh` from the unpacked package root. Requires an installed Flow 2.0 runtime/compiler available as `flow` for Flow code execution; Python 3 and R are optional external runtimes. The preview uses localhost port 8751. Native builds target Linux x86-64 and macOS arm64. Packages do not embed the Flow compiler or R/Python.

## Safety and limitations

This is **not RStudio feature parity** and **not a sandbox**. Do not expose the HTTP server publicly or execute untrusted code. The browser file picker is subject to host/browser support. R/Python currently start fresh processes, not persistent interpreter sessions. Python and R executions are capped at 15 seconds; Flow compile-and-run executions are capped at 60 seconds to account for a cold compiler. The release qualification gate compiles the real Flow router on both platforms and runs live HTTP smoke; it does not certify all user-interface and RStudio parity features.

Versioned archives and SHA256SUMS are published only after all configured cross-platform CI jobs pass. Code remains independently implemented, without RStudio source.
