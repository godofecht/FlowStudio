# Browser plotting integration status — 2026-10-22

The browser Python worker in `docs/app/python-worker.js` now attempts to install the committed `docs/app/plot_capture.py` helper into Pyodide's virtual filesystem, selects Matplotlib's Agg backend, captures up to four PNG figures after a successful Python execution, and returns them in the worker response. The worker retains its serialized execution and inspection queue. The helper bounds each PNG to 1 MiB and the total capture to 3 MiB.

The new `docs/app/plot_history.js` module renders a bounded 12-figure history with DOM-created image elements. It can clear only the view it owns, preserving a separately opened CSV viewer.

**Important:** The main `docs/app/index.html` does **not yet import or call** the plot history module. The worker capture path and plot-history module exist, but end-to-end rendering inside the IDE is still **unimplemented**. The pending UI integration must load the module before the inline workspace script, append `response.plots` after a successful execution, and clear history on Python reset. Do not mark plotting as browser-verified or RStudio-parity-complete.

Validation scope: Node.js mocked-Pyodide worker regression tests and DOM-model history tests; CPython 3.13 Matplotlib helper tests; a Chromium DOM execution check for plot-history append and clear using an injected script (not the hosted page). The actual Pyodide runtime could not be exercised because network access to the runtime CDN was unavailable, and browser navigation to local HTTP/file URLs was blocked by the validation environment.

Flow 2.0 uses the self-hosted `flowc` compiler with a C11 backend (`flow run` and `flow tool compiler/scripts/flowc_emit.flow --strict`). The browser Pages frontend still has **no Flow or R WebAssembly runtime**. Native FlowStudio remains the primary Flow-owned backend. GitHub Pages is static and cannot provide authenticated remote interpreter sessions.

This document describes a partial capability only; see `docs/PARITY.md` for the complete RStudio acceptance matrix.
