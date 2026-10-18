# Editor route and console bootstrap correction — 2026-10-18

Status: source-level regression checks only; native Flow compilation and live HTTP remain unverified.

The native Flow router previously called `s_replace` without importing or declaring
it, to inject console scripts at request time. The current Flow std.string module
does not export that helper. The root editor and /index.html also returned
different HTML because /index.html used the static asset route.

The editor now declares the existing, allowlisted console scripts directly after
the workspace tab bootstrap. The Flow-owned server serves the same checked-in
page for / and /index.html, without an undeclared string helper or per-request
HTML mutation. The existing console and workspace controllers are unchanged.

Regression coverage: `node --test tests/editor_serving_contract.test.js`.
This is a static source contract, not a substitute for compiling Flow, serving
HTTP, or testing a physical browser. The four-pane shell remains unverified
under the cross-platform parity gate.
