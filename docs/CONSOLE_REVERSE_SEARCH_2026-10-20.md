# Reverse console history search (20 October 2026)

Ctrl/Command+R in the focused console searches older commands containing the current input. Repeated presses cycle older matches. Arrow Down navigates back to the original draft. History is isolated per Flow, R and Python and retains its existing 100-command bound. The shortcut prevents browser reload; no request is sent to the Flow server.

Status: **partial / V8-tested**. The source module passed 20 direct V8 behavioural assertions, and Node regression cases were added for history cycling, isolation, draft restoration and workspace keyboard integration. Node, real browser, native Flow compilation and cross-platform execution have not been run in this iteration. This feature does not establish RStudio parity.
