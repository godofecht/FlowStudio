# Browser workspace integration — 2026-10-22

Status: **partial, locally tested, submitted for review**. This change is based on the exact
published PR #7 blobs `docs/app/index.html` (`78c1fc22067e980b0e5e447929032a552a4ec5e4`)
and `docs/app/python-worker.js` (`e666b397685f56683eb02fdbf27bac3812e817a4`).

The static browser IDE adds explicit Python selection execution (Ctrl/⌘+Shift+Enter),
bounded browser-local source draft recovery, and figure capture after Python
exceptions. After a Python exception the IDE now also re-inspects the surviving
interpreter state; failures still appear in the console. The Python worker
continues to use actual Pyodide rather than a simulated evaluator.

Local validation on Linux: `node --test tests/browser_source_selection*.test.js
tests/browser_draft_storage.test.js tests/browser_plot_failure.test.js`
passed 24/24, and `python -m unittest discover -s tests -p
test_plot_capture_limits.py` passed 4/4 using CPython 3.13. JavaScript
syntax checks passed. The Node DOM and worker tests use mocks. No real Pyodide,
physical-browser, native Flow/R interpreter, macOS or hosted CI execution is
claimed. Do not mark RStudio feature parity achieved.

The implementation is proposed on draft PR #7. The next gate is hosted CI,
live Pyodide execution and plotting in a real browser, plus the existing
native Flow acceptance matrix.
