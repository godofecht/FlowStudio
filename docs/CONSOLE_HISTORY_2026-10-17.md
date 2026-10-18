# Opt-in browser console history — 2026-10-17

**Status: partial / Node-tested; not native end-to-end verified.**

The integrated Flow/R/Python console now offers an explicit checkbox for storing
command history in the browser's origin-scoped localStorage. Persistence is off
by default. Enabling saves bounded histories separately for Flow, R and Python;
disabling deletes stored commands for all three languages. A separate control
clears the selected runtime's history. Commands can contain credentials: enable
device persistence only on a trusted computer.

Limits: 100 entries in memory per language, 64 KiB per command, 256 KiB stored
per language. Corrupt/oversized saved data is rejected. Browser storage errors
do not block command execution. Unsent drafts are not persisted.

Validation on Linux x86-64, Node.js 22.16.0:
`node --test tests/console_persistence_core.test.js tests/console_persistence_workspace.test.js`
passed 9/9 against the exact proposed source files. Eight existing workspace
controller tests passed in an isolated DOM/HTTP mock (17/17 combined).
These are browser-module tests, **not** Flow native compilation, physical-browser
integration, persistent interpreter state or RStudio parity.

Next: run the full repository Node suite, build the Flow native server, execute
HTTP acceptance on Linux and macOS, and implement persistent interpreter sessions.
