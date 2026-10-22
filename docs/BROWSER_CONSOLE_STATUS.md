# Browser Python console — 2026-10-22

Status: partial. Eight controller tests passed locally under Node 22.16.0; four mocked-worker integration checks passed against the published HTML in V8. Hosted CI for the new revision is pending. No physical-browser Pyodide execution has been verified.

The browser console shares the persistent Python worker with editor execution. It supports multiline input, history, busy-session rejection, UTF-8 bounds, reset recovery and environment inspection. Browser Flow/R execution, native persistent interpreter sessions, debugging, remote sessions and full RStudio parity remain incomplete.
