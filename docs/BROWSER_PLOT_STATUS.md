# Browser plotting integration status — 2026-10-22

The browser Python worker in `docs/app/python-worker.js` now attempts to install the committed `docs/app/plot_capture.py` helper into Pyodide's virtual filesystem, selects Matplotlib's Agg backend, captures up to four PNG figures after a successful Python execution, and returns them in the worker response. The worker retains its serialized execution and inspection queue. The helper bounds each PNG to 1 MiB and the total capture to 3 MiB.

The new `docs/app/plot_history.js` module renders a bounded 12-figure history with DOM-created image elements. It can clear only the view it owns, preserving a separately opened CSV viewer.

**Integration status:** The main `docs/app/index.html` now loads the plot-history module, appends validated `response.plots` to the workspace after Python execution, and clears the gallery on Python reset. The implementation has source-level validation only; a real Pyodide browser run with Matplotlib has not yet been completed. Do not mark plotting as browser-verified or RStudio-parity-complete.

Validation scope: Node.js mocked-Pyodide worker regression tests and DOM-model history tests; CPython 3.13 Matplotlib helper tests; a Chromium DOM execution check for plot-history append and clear using an injected script (not the hosted page). The actual Pyodide runtime could not be exercised because network access to the runtime CDN was unavailable, and browser navigation to local HTTP/file URLs was blocked by the validation environment.

Flow 2.0 uses the self-hosted `flowc` compiler with a C11 backend (`flow run` and `flow tool compiler/scripts/flowc_emit.flow --strict`). The browser Pages frontend still has **no Flow or R WebAssembly runtime**. Native FlowStudio remains the primary Flow-owned backend. GitHub Pages is static and cannot provide authenticated remote interpreter sessions.

This document describes a partial capability only; see `docs/PARITY.md` for the complete RStudio acceptance matrix.
