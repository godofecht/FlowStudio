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
| Project explorer | partial / DOM-tested | Open project, tree navigation, source-file creation and save; safe rename/delete still missing |
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

## Validation log — 2026-10-15 (Linux x86-64)

**Validated scope:** the exact native C HTTP transport in src/http_bridge.c was compiled with Debian GCC 14.2.0 (C11, -Wall -Wextra -Werror) and exercised through a real loopback socket using the test-only C harness and Python 3.13.5.

Command: `python3 tests/transport_smoke.py`

Result: **15/15 passing** (0.133 seconds on the validation host). Cases cover GET health, localhost Host acceptance, DNS-rebinding Host rejection, duplicate Host/Origin/intent/Content-Length rejection, Transfer-Encoding rejection, absent Content-Length, 128 KiB body limit, embedded NUL, cross-origin execution rejection, missing intent and valid POST payload roundtrip. This test does not execute Flow, R or Python code: the harness uses a fixed echo route to exercise the transport only.

**Build-path correction:** scripts/build.sh now invokes the Flow repository's documented `flow tool compiler/scripts/flowc_emit.flow --strict` command rather than the unsupported `flow build ... --c -o ...` form. The command was confirmed against the current Flow CLI implementation, but not executed with the Flow compiler.

**Still unverified:** native Flow compile/link and actual three-language execution. Flow and R are not installed on the validation host; outbound GitHub DNS resolution was unavailable. Browser interaction and macOS have not been tested. PR #1 remains draft. Do not promote any Flow/R/Python parity feature to verified based on the C-only tests.

## Validation log — 2026-10-15 (browser project integration)

The four-pane workspace now embeds the same project explorer source as web/project.js and connects folder selection, tree navigation, source-file opening, new-file creation, refresh, and saves to the existing editor. The browser-scoped File System Access API is used; no arbitrary filesystem paths are sent to the Flow server. Switching files asks for confirmation if the buffer has unsaved edits. The editor retains the selected file handle for saves.

Static V8 evaluation of the **actual committed HTML scripts** passed 18 assertions: both script parse checks, embedded-module/source equivalence, directory listing, R/Python language inference, exact file-handle opening, path label, unsaved-change refusal, saving, new-file creation, selected-text request payload, execution intent header and console update. A six-test Node DOM suite was committed in tests/workspace_browser.test.js. Both committed browser test suites (11 tests total) were also executed in V8 using a Node-compatible test/assert/fs/vm shim against their exact fetched source; **11/11 passed** after correcting an incorrect empty-tree expectation. The real Node test runner has not yet been run against a checked-out repository. These checks use mocked browser handles, not a physical browser or OS file picker.

**Remaining limits:** Flow native compile/link, served-browser interaction, real OS file permissions, actual language execution, macOS compatibility and filesystem conflict handling remain unverified. The project explorer does not implement rename/delete and is not an RStudio project parser. Do not treat DOM-mock passes as full feature parity.

## Next implementation order

**M1:** Build and integration test existing code on Linux and macOS; fix Flow compiler or linkage errors, add reliable exit-code propagation and resource cleanup; test security limits on actual browsers.

**M2:** Flow-owned persistent R and Python sessions with framed asynchronous output, timeouts/interrupts, environment snapshotting, per-session working directories and explicit lifecycle ownership.

**M3:** Project and file management with path scope, atomic save and modified-file conflict protection. Local plotting protocol, PNG/SVG display and history.

**M4:** Language-aware editor, packages, help, datasets and source diagnostics.

**M5:** Quarto, debugging, remote security/permissions, accessibility, release packaging.

## Quality gate

No feature advances to verified without recorded exact commands, versions, sample inputs, expected and actual outputs, exit codes and operating systems. Numerical results from R and Flow must be compared with explicitly justified absolute/relative error tolerances; performance claims require reproducible cold/warm measurements. Never infer acceptance from a visual screenshot or from an unexecuted example.
