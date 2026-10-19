# FlowStudio RStudio parity matrix

**Baseline:** RStudio Desktop + Server core scientific IDE workflows. This is a goal and acceptance test list, not a claim of equivalence.

Legend: **unverified** = implementation exists but has not been built/executed in a validated environment; **partial** = explicitly narrower than baseline; **missing** = no implementation. A feature becomes **verified** only with repeatable end-to-end tests on macOS arm64 and Linux x86-64.

| Feature | 2026-10-15 state | Minimum acceptance criterion |
| --- | --- | --- |
| Four-pane IDE shell | unverified | Source, environment, console and plots render; keyboard/accessibility checks |
| File open / save | partial / conflict-aware browser saves wired; physical browser and native unverified | Native file-picker and download fallback round-trip UTF-8 |
| Flow source execution | unverified | Compile and run valid code; surface diagnostics for invalid code |
| R source execution | partial / unverified | Run via installed R; preserve state across evaluations |
| Python source execution | partial / unverified | Run via installed Python; preserve state across evaluations |
| Editor selection execution | unverified | Selection runs without accidentally executing entire buffer |
| Persistent REPL/session | partial / Python/R worker and HTTP routes; native cross-platform verification pending | Incremental variables and package state persist until reset |
| Variable inspector | partial / browser wiring and basic Python/R values; browser acceptance pending | Nested objects / types / dimensions inspectable and refresh after execution |
| Plot viewer | partial / Node-tested PNG import and integrated workspace tab; native unverified | png/svg plot history, zoom, save and deterministic device lifecycle |
| Project explorer | partial / DOM-tested | Open project, tree navigation, source-file creation and save; safe rename/delete still missing |
| Data viewer | partial / browser-local CSV/TSV viewer integrated as workspace tab; native unverified | Interactive sortable/filterable tabular datasets including missing values |
| Completion / language server | missing | R, Flow and Python completion/diagnostics |
| Packages pane | partial / read-only installed Python/R inventory; native/browser unverified | List, install, update with environment-aware package sources |
| Git pane | missing | Status, diff, stage, commit and branch operations |
| Help pane | missing | Context-aware language/function docs |
| Find / replace / cross-file search | partial / Node + V8-tested | Literal in-buffer find next/previous, single/all replacement and project-wide search implemented; incremental indexing, regex and physical-browser verification missing |
| Percent-delimited source cells | partial / Node-tested; native execution unverified | Run only the active `# %%` code cell in Flow/R/Python; markdown and empty cells do not execute |
| Jupyter notebook export | partial / Node-tested standalone and editor integration; served browser unverified | Convert Python/R percent-delimited code and markdown cells into valid nbformat 4; execute exported notebook independently |
| R Markdown / Quarto | missing | Render notebook with inline plots and HTML export |
| Source debugger | missing | Breakpoints, stack, variables, step execution |
| Remote/server mode | missing | Authenticated, origin-aware multi-user sessions with isolation |
| Diagnostics / profiling | missing | Resource/time tracing and useful language-specific diagnostics |
| Cross-platform packaging | missing | Installable signed/reproducible macOS and Linux releases |
| Accessibility | partial / unverified | Full keyboard navigation, screen reader labels, resize and contrast checks |
| RStudio project import | partial / browser-local .Rproj editor; Node-tested, native unverified | Open and preserve basic .Rproj project settings |

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

## Validation log — 2026-10-15 (project-wide search)

Added read-only, browser File System Access API project search in web/project.js and the served web/index.html workspace. Results include the exact browser file handle, path, line, column, source offset and preview; selecting a result opens the source and selects the match in the editor. The existing unsaved-change confirmation is respected. Search content remains in the browser and is not sent to the execution HTTP API.

Limits: 256-character literal queries; 500 entries per directory, 12 directory levels, 1000 searched files, 1 MiB per file and 200 matches. Search is case-insensitive by default with an explicit case-sensitive option. Large files are skipped and truncation is reported. Regex metacharacters are treated as literal text; no arbitrary regular expression execution is exposed.

**Validation:** V8 evaluated the exact committed project module and 8 new test cases (8/8 passed). A Node-compatible V8 test/assert/vm harness evaluated the exact committed browser HTML scripts and 9 workspace integration tests (9/9 passed), including search navigation, unsaved-file protection and no HTTP transfer of search contents. These are **mocked browser and filesystem handles**, not physical-browser integration. The tests are committed in tests/project_search.test.js and tests/workspace_browser.test.js. A real Node.js test runner, OS file-picker interaction, Flow compilation, and Flow/R/Python execution remain unverified.

**Remaining:** in-buffer find/replace, indexed incremental search, renaming/deleting project files, filesystem conflict handling and all other unimplemented parity features.

## Validation log — 2026-10-15 (in-buffer editor find/replace)

Implemented a bounded, pure JavaScript find/replace engine in web/editor_find.js, embedded verbatim into the served editor HTML. Literal search supports forward/backward wrap, case sensitivity, Unicode UTF-16 selection offsets, replacement of exactly selected matches and atomic replace-all. The editor includes find/replace controls and Ctrl/⌘+F, Ctrl/⌘+H, F3 and Shift+F3 navigation. The operation is browser-local and does not send source content to the execution API.

Limits: 256-character queries, 10,000-character replacement, 2 MiB buffer, 10,000 matches. Replace-all refuses a truncated match set before editing. No regex replacement or cross-file mutation.

Validation: 10/10 pure-module tests passed under local Node.js 22.16.0 with the test file in tests/editor_find.test.js. A V8 Node-compatible DOM/VM shim evaluated the actual proposed web/index.html, mirrored modules and tests/workspace_browser.test.js: 13/13 workspace tests passed (9 existing, 4 new). These are mock DOM tests; the native Flow server, OS browser and physical file picker were not exercised. The HTML includes embedded module source because the current native server only serves the root page.

## Validation log — 2026-10-15 (local CSV/TSV data viewer)

Implemented a standalone, browser-local tabular viewer in web/data.html, backed by web/data_viewer.js and web/data_page.js. Open web/data.html directly in a browser; its script paths are relative and it does not require a Flow server. Supports quoted CSV/TSV, escaped quotes, multiline fields, duplicate headers, missing cells, stable numeric/text sorting, filtering and 50-row pages. File contents are not uploaded; table cells use textContent. The parser enforces 8 MiB, 25,000 data rows, 256 columns and 65,536 characters per field.

Validation: 8/8 Node.js 22.16.0 parser tests passed in a local working copy; 2/2 assertions from the committed smoke test passed in V8 against the committed parser. The committed browser UI and parser passed seven V8 mock-DOM assertions for opening a file, rendering, sorting and filtering. Physical-browser tests and native Flow server compilation are still missing. The Flow router does not serve /data yet; do not claim this is integrated into the main IDE.

## Next implementation order

**M1:** Build and integration test existing code on Linux and macOS; fix Flow compiler or linkage errors, add reliable exit-code propagation and resource cleanup; test security limits on actual browsers.

**M2:** Flow-owned persistent R and Python sessions with framed asynchronous output, timeouts/interrupts, environment snapshotting, per-session working directories and explicit lifecycle ownership.

**M3:** Project and file management with path scope, atomic save and modified-file conflict protection. Local plotting protocol, PNG/SVG display and history.

**M4:** Language-aware editor, packages, help, datasets and source diagnostics.

**M5:** Quarto, debugging, remote security/permissions, accessibility, release packaging.

## Quality gate

No feature advances to verified without recorded exact commands, versions, sample inputs, expected and actual outputs, exit codes and operating systems. Numerical results from R and Flow must be compared with explicitly justified absolute/relative error tolerances; performance claims require reproducible cold/warm measurements. Never infer acceptance from a visual screenshot or from an unexecuted example.

## Execution failure propagation — 2026-10-17

The Flow-owned execution router now distinguishes successful subprocess completion
(HTTP 200), a nonzero child exit (422), a spawn/runtime failure (503), and
execution timeout (504). The native C transport maps each status to its HTTP
reason phrase, and the browser reports execution failures as errors.
The live HTTP smoke suite asserts Python runtime exceptions and syntax errors,
plus R/Flow failures when those interpreters are installed. The transport
harness exercises all three failure status codes.

**Validation status: partial / unverified.** The actual Flow 2.x application
has not been compiled and exercised through live HTTP on Linux x86-64 and
macOS arm64. No parity milestone is promoted.

## Percent source cells — 2026-10-17

The source editor recognizes `# %%` code boundaries and `# %% [markdown]` non-executable boundaries. Run cell and Ctrl/⌘+Shift+Enter send only the active code cell through the existing Flow-owned `/api/run/{language}` route. UTF-8 payloads exceeding 128 KiB are rejected client-side; server request bounds remain authoritative. This is **not** a notebook renderer, and cells **do not share interpreter state**: each server execution still starts a new process. Markers inside multiline strings are not lexically disambiguated. **Validation (2026-10-17, Linux x86-64):** `node --test tests/source_cells.test.js` passed 8/8 with Node.js 22.16.0 against the locally prepared parser. The exact committed parser and workspace test sources were also executed in a V8 Node-compatible harness: 25/25 passed (8 parser and 17 mocked workspace). The four embedded HTML scripts passed V8 syntax checks, and mocked cell execution submitted only the active cell. This is not a native or physical-browser acceptance test. Native Flow compilation, real Flow/R/Python HTTP execution, browser interaction and macOS remain unverified.

## Validation log — 2026-10-17 (Flow-served integrated console)

The Flow server now injects two allowlisted JavaScript assets into the existing
four-pane editor response. A browser-side controller creates the interactive
console input within the existing console panel and sends commands through the
existing Flow-owned execution endpoints. It shares the editor runtime selection,
console output and execution status; source execution and console submissions
are serialized in the browser. Console history and draft buffers are separated
by runtime. HTTP execution failures are displayed without erasing submitted
commands. The Flow application continues to run each command in a fresh
subprocess; **interpreter state does not persist between submissions**.

Nine isolated Node.js regression tests passed against
`web/workspace_console.js` and `web/console.js` using mocked DOM and HTTP
responses. The integration was tested with an isolated DOM/HTTP mock, not a native server.
Run `python3 tests/console_integration_http_smoke.py` against the native
FlowStudio executable to verify the served HTML and assets.
**Native Flow compilation, served-browser interaction, actual interpreter
execution, Linux/macOS end-to-end acceptance and RStudio parity remain unverified.**

## Conflict-aware browser source saves — 2026-10-17

The served four-pane editor now embeds the existing tested web/file_save.js module. Opening a file records its text baseline; saving re-reads the browser-granted file and refuses to overwrite a changed baseline. Successful saves update the baseline. Save-as reads the selected destination before writing, and fallback imports clear stale file handles. Failures preserve the unsaved editor buffer and report an error. This is best-effort conflict detection, **not an atomic compare-and-swap**: another process could still modify the file between the comparison and createWritable. Browser File System Access permissions, actual OS races and macOS are not validated. Existing 7 isolated file-save tests and new workspace wiring assertions cover the local contract; full served-browser acceptance remains pending.


## RStudio project metadata editor — 2026-10-17

FlowStudio now serves a browser-local `/rproj` editor for existing `.Rproj` files. It parses supported settings, preserves unknown fields, comments, BOM, ordering and CRLF, validates edits, and uses the existing conflict-aware File System Access save implementation. Browsers without writable file handles download the modified file instead. Parsing and saving never execute project contents or send them to the HTTP backend. Node.js parser and mocked DOM tests passed 8/8 locally; actual Flow server build, physical-browser interaction and macOS remain unverified. This is not full RStudio project import: package environments, build configuration and R session settings are not applied.

## Workspace Plots/Data tabs — 2026-10-17

The Flow-owned router now serves a keyboard-operable Files/Plots/Data tab controller in the fourth pane. Plots and Data reuse the existing same-origin, browser-local PNG history and CSV/TSV viewers in lazy-loaded iframes; no file contents are uploaded to the server. The native HTTP transport allows same-origin frames while rejecting cross-origin framing (X-Frame-Options: SAMEORIGIN and CSP frame-ancestors 'self').

**Partial / unverified:** five Node controller tests and three integration-transform tests passed locally on Linux x86-64. Native Flow compile/link, HTTP/browser acceptance and macOS validation were not run. There is no automatic plot capture from language runtimes or in-memory dataset inspector. This does not meet RStudio parity.

## Validation log — 2026-10-18 (draft recovery asset integration)

Published `web/editor_recovery.js` as the explicit `/editor_recovery.js` asset route, and loaded the controller once after the editor's DOM and existing script are ready. Added `tests/test_recovery_wiring.py` to check route allowlisting, correct script placement and controller API presence. Static fetched-source checks confirmed all six corresponding invariants; the new Python unittest and physical browser recovery workflow have not yet been executed. This does not verify that draft persistence works in a real browser or that the native Flow server compiles. The recovery controller retains its earlier isolated tests, but no new parity feature is marked verified here.

## Persistent interpreter HTTP wiring — 2026-10-19 (candidate)

The Flow-owned dispatcher now routes R and Python source execution to the
existing native persistent interpreter bridge. Added explicit same-origin,
intent-gated POST inspection and reset routes, and live HTTP regression cases
for state persistence, exception recovery, inspection and reset. The Flow
execution path remains separate. Both HTTP listener and accepted sockets
are marked FD_CLOEXEC before child interpreters are spawned.

**Status: partial / native integration unverified.** Local candidate-level
transformation and mock browser tests do not establish a passing Flow compile
or live HTTP acceptance. R is optional in the smoke test, and has not been
independently accepted on both target platforms. Session ownership is shared
by all local clients, not isolated per project or user. Interpreter IPC
failures/timeouts are currently reported as HTTP 422 by the dispatcher;
proper 503/504 mapping remains a follow-up. The editor environment panel is
not yet connected to the inspection/reset endpoints. No RStudio parity claim.

## Persistent environment integration — 2026-10-19

The Flow-owned asset allowlist serves `/environment.js` and `/workspace_environment.js`.
The four-pane editor loads the inspector after the console and refreshes Python/R
variables following successful execution or a language exception (HTTP 200/422).
The interactive console uses the same refresh hook. The execution language is
captured before asynchronous HTTP dispatch, avoiding a runtime-switch mismatch.
The panel provides explicit refresh/reset controls; R and Python kernels remain
shared by all clients of this localhost process and must not be exposed remotely.

**Status: partial.** Isolated Node controller tests and source-wiring contracts
are not physical-browser acceptance. The Flow-owned server and persistent
HTTP endpoints require Linux/macOS integration verification on this exact branch.
Kernel timeout/error classification, nested variable inspection, project-scoped
session isolation, plotting, package management, debugging and full RStudio parity
remain incomplete.

## Python/R percent-source to Jupyter notebook export — 2026-10-19

A new Flow-allowlisted local `/notebook` page imports Python or R source or
accepts pasted text, parses the existing `# %%` code and markdown boundaries,
and downloads a Jupyter Notebook v4.5 JSON file with appropriate Python 3 or
IRkernel metadata. The page uses browser-local file reading and downloads; it
never sends source to the server or executes code. Outputs are intentionally
empty, and Flow notebook export is explicitly unsupported without a Flow kernel.

**Status: partial.** Seven isolated Node tests passed for notebook structure,
Unicode, markdown conversion, source bounds and filename normalization. Two
additional mocked-controller tests passed locally. Real served-browser
acceptance, exported notebook execution, R kernel installation, native Flow
compilation and macOS acceptance remain unverified. This is not Quarto or
R Markdown rendering and does not establish RStudio parity.


## Editor-integrated Jupyter export — 2026-10-19

The served four-pane FlowStudio editor now exposes **Export notebook** for the
current, including unsaved, Python/R source buffer. It reuses the already
allowlisted percent-cell parser and Jupyter notebook exporter, preserves the
current runtime and filename, downloads locally without network requests,
and rejects Flow, empty and oversized source. Failed downloads revoke their
object URLs. The Flow-owned static router explicitly allowlists the new
workspace controller; it does not expose arbitrary filesystem routes.

**Status: partial.** Five focused Node tests passed locally against the
controller and source parser, covering Python/R metadata, unsaved buffer,
markdown cells, size/language guards, URL cleanup and serving contracts.
Native Flow compilation, real served-browser interaction, R kernel execution,
Linux/macOS end-to-end acceptance and independent notebook execution remain
unverified. No RStudio parity criterion is promoted.

## Jupyter v4 notebook source import — 2026-10-19

The local notebook page now imports Python/R Jupyter v4 `.ipynb` files into
percent-delimited source, preserving code and markdown cells, and re-exports
source-only notebooks. Import validates kernel metadata, source shape, cell count,
2 MiB size bounds and ambiguous embedded percent-cell boundaries. Stored
execution outputs are deliberately discarded, not executed or represented as
new results. Unsupported kernels and raw cells are rejected.

**Status: partial / Node-tested.** Unit tests cover Python/R round-trips,
malformed inputs, unsupported kernels, saved-output omission and size limits.
The native Flow server, physical-browser import, macOS and notebook execution
remain independently unverified; this does not satisfy RStudio parity.

## Read-only Python/R package inventory — 2026-10-19

A Flow-allowlisted /packages page queries installed package names and versions
through the existing persistent interpreter execution endpoints. Python uses
importlib.metadata; R uses base installed.packages(). The fixed source does not
install, update or remove packages. The page provides bounded filtering,
deduplication, safe text rendering and stale-response protection. The main IDE
links to the page.

**Status: partial / local Node-tested only.** Eight controller tests passed
locally, including Python namespace isolation and stale-request cancellation;
a Python source probe enumerated installed distributions.
Native Flow server routing, live HTTP execution, actual R execution,
macOS and physical-browser acceptance remain unverified. Package
installation/update and environment-specific library management are missing.
