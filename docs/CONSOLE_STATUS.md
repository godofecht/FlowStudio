# Interactive console: implementation and verification status

Updated 2026-10-17. FlowStudio's Flow-owned server now has explicit read-only routes for `/console`, `/console.html`, `/console.js` and `/console_page.js`. The standalone console page sends Flow, R and Python source to the existing `/api/run/{language}` routes with the required intent header. No alternate server or interpreter implementation is introduced.

The browser console supports Enter-to-run, Shift+Enter multiline input, per-language in-memory history (100 entries), UTF-8 request limit (64 KiB), unsent-draft preservation, and serialized requests. Output is rendered as text and bounded. HTTP 422/503/504 are reported separately.

**Status: partial.** This is a standalone `/console` page, not yet integrated into the main four-pane editor. Every request still starts a fresh interpreter; no persistent REPL state, stdin, debugger, package management or remote access is provided.

**Validation:** Nine JavaScript controller/page tests passed in a V8 Node-compatible harness against the exact Git blobs. Browser scripts parsed successfully. `src/data_routes.flow` and `src/data_routes_smoke.flow` were checked against the current Flow syntax, but were **not compiled**. `tests/console_http_smoke.py` is an acceptance test for a running native server; it has not passed because Flow is not installed in the validation environment. No physical-browser, R runtime, macOS or Linux native integration pass is claimed.

**Next:** compile the native server, run `python3 tests/console_http_smoke.py` and `python3 tests/asset_routes.test.py`, then integrate console input into the main editor and add persistent language sessions.
