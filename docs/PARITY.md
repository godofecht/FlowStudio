# FlowStudio RStudio parity matrix

**Baseline:** RStudio Desktop + Server core scientific IDE workflows. This is a goal and acceptance test list, not a claim of equivalence.

Legend: **unverified** = implementation exists but has not been built/executed in a validated environment; **partial** = explicitly narrower than baseline; **missing** = no implementation. A feature becomes **verified** only with repeatable end-to-end tests on macOS arm64 and Linux x86-64.

| Feature | 2026-10-15 state | Minimum acceptance criterion |
| --- | --- | --- |
| Four-pane IDE shell | unverified | Source, environment, console and plots render; keyboard/accessibility checks |
| File open / save | unverified | Native file-picker and download fallback round-trip UTF-8 |
| Flow source execution | unverified | Compile and run valid code; surface diagnostics for invalid code |
| R source execution | partial / unverified | Run via installed R; preserve state across evaluations |
| Python source execution | partial / unverified | Run via installed Python; preserve state across evaluations |
| Editor selection execution | unverified | Selection runs without accidentally executing entire buffer |
| Persistent REPL/session | missing | Incremental variables and package state persist until reset |
| Variable inspector | missing | Nested objects / types / dimensions inspectable and refresh after execution |
| Plot viewer | missing | png/svg plot history, zoom, save and deterministic device lifecycle |
| Project explorer | missing | Open project, tree navigation, safe rename/delete |
| Data viewer | missing | Interactive sortable/filterable tabular datasets including missing values |
| Completion / language server | missing | R, Flow and Python completion/diagnostics |
| Packages pane | missing | List, install, update with environment-aware package sources |
| Git pane | missing | Status, diff, stage, commit and branch operations |
| Help pane | missing | Context-aware language/function docs |
| Find / replace / cross-file search | missing | Editor and workspace search with incremental results |
| R Markdown / Quarto | missing | Render notebook with inline plots and HTML export |
| Source debugger | missing | Breakpoints, stack, variables, step execution |
| Remote/server mode | missing | Authenticated, origin-aware multi-user sessions with isolation |
| Diagnostics / profiling | missing | Resource/time tracing and useful language-specific diagnostics |
| Cross-platform packaging | missing | Installable signed/reproducible macOS and Linux releases |
| Accessibility | partial / unverified | Full keyboard navigation, screen reader labels, resize and contrast checks |
| RStudio project import | missing | Open and preserve basic .Rproj project settings |

## First milestone: an honest executable slice

A Flow 2.x application in src/main.flow delegates only POSIX socket handling and temporary-file operations to src/http_bridge.c. Three request routes each run one language in a fresh child process, with an explicit 15-second process-group timeout. The browser workspace provides a text editor, selection execution, console output, and file opening/saving.

The present slice is intentionally NOT a persistent interpreter, a full RStudio-compatible UI, a secure remote server or a plotting workstation. It binds to loopback only. Executed programs retain all the permissions of the user running the server. It must not be exposed to remote users or run with elevated privileges.

## Next implementation order

**M1:** Build and integration test existing code on Linux and macOS; fix Flow compiler or linkage errors, add reliable exit-code propagation and resource cleanup; test security limits on actual browsers.

**M2:** Flow-owned persistent R and Python sessions with framed asynchronous output, timeouts/interrupts, environment snapshotting, per-session working directories and explicit lifecycle ownership.

**M3:** Project and file management with path scope, atomic save and modified-file conflict protection. Local plotting protocol, PNG/SVG display and history.

**M4:** Language-aware editor, packages, help, datasets and source diagnostics.

**M5:** Quarto, debugging, remote security/permissions, accessibility, release packaging.

## Quality gate

No feature advances to verified without recorded exact commands, versions, sample inputs, expected and actual outputs, exit codes and operating systems. Numerical results from R and Flow must be compared with explicitly justified absolute/relative error tolerances; performance claims require reproducible cold/warm measurements. Never infer acceptance from a visual screenshot or from an unexecuted example.
