# FlowStudio RStudio parity matrix

**Baseline:** RStudio Desktop + Server core scientific IDE workflows. This is a goal and acceptance test list, not a claim of equivalence.

Legend: **unverified** = implementation exists but has not been built/executed in a validated environment; **partial** = explicitly narrower than baseline; **missing** = no implementation. A feature becomes **verified** only with repeatable end-to-end tests on macOS arm64 and Linux x86-64.

| Feature | 2026-10-15 state | Minimum acceptance criterion |
| --- | --- | --- |
| Four-pane IDE shell | unverified | Source, environment, console and plots render; keyboard/accessibility checks |
| File open / save | partial / conflict-aware browser saves and Save As picker wired; physical browser and native unverified | Native file-picker and download fallback round-trip UTF-8 |
| Flow source execution | partial / native Flow subprocess route integrated into browser IDE at /app/; physical-browser acceptance pending | Compile and run valid code; surface diagnostics for invalid code |
| R source execution | partial / browser webR 0.6.0 integrated, Node-mock tested; real webR and native R unverified | Run via installed R; preserve state across evaluations |
| Python source execution | partial / unverified | Run via installed Python; preserve state across evaluations |
| Editor selection execution | partial / Node-tested browser selection; native and physical-browser unverified | Selection runs without accidentally executing entire buffer |
| Persistent REPL/session | partial / browser Python worker and browser webR session; native R/Python persistence missing | Incremental variables and package state persist until reset |
| Variable inspector | partial / browser Python variables and browser R top-level metadata; nested inspection missing | Nested objects / types / dimensions inspectable and refresh after execution |
| Plot viewer | partial / Node-tested PNG import and integrated workspace tab; native unverified | png/svg plot history, zoom, save and deterministic device lifecycle |
| Project explorer | partial / browser Pages open/create/save and confirmed active-file delete with baseline conflict checks; 10 regression tests V8-shim passed; physical-browser deletion unverified | Open project, tree navigation, source-file creation and save; scoped delete is implemented, copy-verify-delete rename implemented with non-atomic filesystem race limits; physical-browser acceptance remains missing |
| Data viewer | partial / CSV/TSV plus bounded Python/R environment table snapshots wired; real Pyodide/webR and physical browser unverified | Interactive sortable/filterable tabular datasets including missing values |
| Completion / language server | partial / browser Python AST and R parse-only syntax diagnostics wired; mocked V8/Node checks, live interpreters unverified; completion and Flow diagnostics missing | R, Flow and Python completion/diagnostics |
| Packages pane | partial / browser Python inventory/install and webR 0.6.0 inventory/install; mocked Node tests, live interpreters unverified | List, install, update with environment-aware package sources |
| Git pane | missing | Status, diff, stage, commit and branch operations |
| Help pane | partial / browser Python live-global/builtin docstrings and installed R Rd help wired; Node/V8 contract tests, live Pyodide/webR and physical browser unverified; Flow help missing | Context-aware language/function docs |
| Find / replace / cross-file search | partial / Node + V8-tested | Literal in-buffer find next/previous, single/all replacement and project-wide search implemented; incremental indexing, regex and physical-browser verification missing |
| Percent-delimited source cells | partial / browser Python Run Cell integrated; Node and real-browser validation pending; Flow browser execution unavailable; browser R unverified | Run only the active `# %%` code cell in Flow/R/Python; markdown and empty cells do not execute |
| Sequential percent-cell notebooks | partial / Python and R Run All wired; Node-tested, live runtimes unverified | Execute cells in order, retain interpreter state, show per-cell output and stop on error |
| Jupyter `.ipynb` import/export | partial / browser UI wired and Node regression coverage; physical-browser file round-trip and live Python/R kernels unverified | Import/export nbformat 4 Python/R code and Markdown cells through file picker/download; validate with nbformat; preserve source; verify live outputs in Chromium and cross-platform acceptance |
| R Markdown / Quarto | partial / offline HTML report export from Python/R percent-cell notebooks; no Quarto/R Markdown rendering | Render notebook with inline plots and HTML export; verify actual Quarto/R Markdown format compatibility |
| Source debugger | missing | Breakpoints, stack, variables, step execution |
| Remote/server mode | missing | Authenticated, origin-aware multi-user sessions with isolation |
| Diagnostics / profiling | missing | Resource/time tracing and useful language-specific diagnostics |
| Cross-platform packaging | missing | Installable signed/reproducible macOS and Linux releases |
| Accessibility | partial / unverified | Full keyboard navigation, screen reader labels, resize and contrast checks |
| RStudio project import | partial / browser-local .Rproj editor; Node-tested, native unverified | Open and preserve basic .Rproj project settings |

## 2026-10-23: native Flow execution from the browser workspace

The Flow-owned native HTTP server now allowlists the actual `docs/app/` workspace at `http://127.0.0.1:8751/app/` (also `localhost`). The existing browser source/selection/cell/console execution path sends Flow source to the already-implemented `POST /api/run/flow` route, with the existing intent header and a bounded request. Compiler diagnostics and nonzero exit statuses return to the console; Flow has no persistent environment inspector or notebook Run All yet. Python and R continue to run in their browser-local persistent runtimes. GitHub Pages **does not** attempt native Flow execution and does not silently contact a local server.

**Status: partial.** Added Node regression coverage for strict localhost origin gating, successful execution, compiler errors and input/output limits; extended native HTTP smoke with `/app/` asset loading and unknown-route rejection, and explicit-route completeness tests. These changes do not imply live browser acceptance or native interpreter persistence. Run `python3 scripts/verify_native.py` on both supported operating systems, then use a physical browser against `/app/` to qualify Flow source/selection/cell execution. The loopback server executes source with the local user's permissions; never expose it remotely.

## 2026-10-23: offline notebook HTML report export

The browser IDE can export an actual self-contained HTML document from Python/R percent-cell source, executed text outputs and PNG plots, using the same validated nbformat 4 encoding as Jupyter export. It includes a deliberately limited Markdown renderer (headings, lists and paragraphs), HTML escaping, bounded cell/output sizes, no external dependencies and a restrictive Content Security Policy. Output is included only when its source and language match the current editor. The export runs locally without uploading source or executing notebook cells.

**Status: partial / V8-validated.** The report module, actual notebook codec and source-cell parser passed eight local V8 checks including Python/R escaping, outputs, PNG filtering, size refusal, IDE wiring and inline-script syntax. A committed Node regression suite adds four tests; Node CI and physical-browser download acceptance have not yet been independently confirmed. This is not Quarto or R Markdown rendering; rich Markdown, HTML widgets, interactive plots, document themes and PDF export are missing.

## 2026-10-23: browser installed-help lookup

The browser data/plots pane now includes a bounded help-topic lookup for Python identifiers (including static attribute resolution) and installed R `package::topic` documentation. Python requests run against the persistent Pyodide worker without evaluating the supplied topic as an expression or importing modules by name. R requests use the persistent webR session and installed Rd documentation. Help text is inserted using DOM textContent, not HTML. Requests are serialized with interpreter work and stale results are ignored on reset or language change. The helper limits identifiers and output sizes.

**Status: partial.** Node/V8 regression coverage checks topic rejection, safe rendering, interpreter request contracts, and stale-result handling. Real Pyodide/webR help lookup in Chromium, Flow language documentation, native help and context-sensitive source-symbol integration remain unverified or missing.

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

## Browser-first consolidation — 2026-10-21

A static `docs/app/` four-pane browser IDE is now implemented on `feat/github-pages-browser-ide-20261021`, with source open/download, basic local CSV/TSV/image previews, and a persistent Python Pyodide Web Worker. Python executes on the user's device; the Pyodide 0.27.7 JavaScript runtime is downloaded from jsDelivr when first needed. Flow and R execution do **not** run in the GitHub Pages preview yet: they require real WebAssembly compilation/runtime integration. The CSV/TSV viewer in this preview uses a deliberately simple delimiter splitter and does not yet parse quoted CSV values. GitHub Pages is static hosting, not a remote execution server. This preview does not replace the Flow-owned native server, and does not satisfy full RStudio parity.

**Verification:** GitHub source fetch confirmed all four published files and eight static integration contracts. A six-case Node regression suite is committed in `tests/browser_pages.test.js`, but has **not been run** against a local checkout, and real Pyodide execution, physical browser behaviour, hosted Pages deployment and cross-platform acceptance are **unverified**. Issue #3 documents Pages enablement: Settings → Pages → Build and deployment → GitHub Actions. The current Pages workflow uploads `docs/` from main and was not modified.

## Browser data viewer consolidation — 2026-10-22

The Pages workspace now exposes the existing FlowStudio CSV/TSV parser and data-page controller as local static assets in `docs/app/`, rather than splitting lines/fields naively. It supports quoted CSV cells, escaped quotes, embedded newlines, BOM, duplicate column labels, bounded file sizes, filtering, numeric/text sorting, pagination and local file-picker fallback. The viewer is embedded in the workspace pane and the image input remains available after repeated imports; no dataset is sent to a server. Source modules were copied byte-for-byte from `web/data_viewer.js` and `web/data_page.js` using their existing Git blobs.

**Verification:** six Node regression tests committed in `tests/browser_pages_data.test.js`; physical-browser behaviour and Pages deployment remain unverified until exercised. Flow and R are not yet browser executable, and native Flow remains the primary server/backend implementation. Do not mark RStudio data-viewer parity verified without the full browser and platform acceptance tests.

## Browser selection, recovery and exception-safe plots — 2026-10-22

Draft PR #7 now proposes exact Python selection execution (Ctrl/⌘+Shift+Enter),
300 ms debounced browser-local source/filename/language recovery, and capture
of Matplotlib figures even when source execution raises. Python environment
inspection is also attempted after source errors. The existing Python package
panel remains browser-only; Flow and R browser execution are not implemented.

Linux local validation: Node.js 22.16.0, 24/24 tests passed with
`node --test tests/browser_source_selection*.test.js tests/browser_draft_storage.test.js tests/browser_plot_failure.test.js`;
CPython 3.13.5 with Matplotlib, 4/4 tests passed with
`python3 -m unittest discover -s tests -p test_plot_capture_limits.py`.
Tests cover mock workers and DOM, not real Pyodide or a physical browser.
No macOS acceptance or native Flow/R/Python end-to-end parity is claimed.

## Browser project files and conflict-aware saves — 2026-10-22

Draft PR #7 integrates the existing browser File System Access project explorer
and conflict-aware source writer into the static Pages workspace. A user-granted
project directory can be traversed lazily (bounded depth and entries), source
files opened, and root-level source files created. Explicit disk saves compare
the current file against the snapshot read on open or last successful save;
external changes refuse overwrite. Switching project files checks for unsaved
editor edits; opening an ordinary local file detaches the project write handle.
The browser still offers the independent download-source fallback.

Local validation: Node.js 22.16.0, 40/40 tests passed for the available
browser-focused test fixture (including project controller and filesystem
integration, selection, persistence and plot failure tests). The project and
file-save modules are exact copies of the already committed native-web modules
and have matching Git blob SHAs. The HTML fixture was reconstructed from a
previously validated artifact and does not establish a full physical-browser
acceptance test against the GitHub-hosted branch.

Limitations: folder access requires a compatible browser with the File System
Access API and explicit user permission; no cross-browser filesystem fallback,
file rename/delete, durable handle restoration, native Flow execution from
Pages, or verified browser/OS interaction is claimed. Native Flow remains the
primary application/server backend; browser project operations are local only.

## Browser Python Run Cell — 2026-10-22

Draft PR #7 adds a Run Cell button and Ctrl/Command+Alt+Enter. The active Python `# %%` code cell is submitted to the existing Pyodide worker without delimiter lines. Markdown and empty cells are rejected. The browser parser mirrors the lexical fix proposed on PR #6 (triple-quoted strings, R multiline strings, mixed newlines and a 10,000-cell bound). The parser is not a complete language grammar. Flow/R browser execution is not implemented. Browser and native end-to-end acceptance remain outstanding; no RStudio parity claim.

## Browser R interpreter integration — 2026-10-22

The static Pages workspace now has an R execution path backed by pinned webR v0.6.0, using its PostMessage channel for hosts without cross-origin isolation. Editor, selection, percent-cell and console submissions share one persistent browser-local R interpreter, with serialized captureR evaluation, bounded output, global-environment inspection, canvas bitmap plot rendering and explicit session reset. Flow execution still requires the native Flow-owned server. This is actual webR API integration, not an R syntax simulator.

Validation: six Node.js tests using a mocked webR API passed locally on Node 22.16.0. Static HTML integration and JavaScript syntax checks passed before publication. No live webR download, actual R execution, physical-browser interaction or macOS acceptance has been run; these capabilities remain **partial / unverified**. The PostMessage channel cannot interrupt running R code or support interactive readline/browser prompts. Package installation, persistent filesystem state, and robust plot history are not implemented for browser R.

## Browser sequential Python/R percent-cell notebooks — 2026-10-23

Run All Cells is now wired to the existing persistent Pyodide and webR runtimes. Python and R code cells execute sequentially; Markdown is displayed as escaped source text, bounded text and plots are shown per cell, errors stop execution, and reset invalidates stale results. Cancellation retains the execution lock until an in-flight interpreter call settles. Limits: 128 executable cells, 64 KiB per cell, 1 MiB aggregate text. The Node runner regression suite and inline JavaScript syntax check passed locally, but real interpreter execution in Chromium and full cross-platform validation remain unverified. This is partial notebook support, not R Markdown, Quarto or Jupyter parity; .ipynb persistence, rich MIME display and notebook HTML export are not part of this commit.

## Browser Jupyter import/export integration — 2026-10-23

The draft browser IDE now wires `notebook_format.js` and `notebook_io.js` into explicit Open/Export `.ipynb` controls. The implementation serializes Python/R source cells and bounded captured outputs, rejects unsupported notebook structures, and guards asynchronous file reads against concurrent execution. Node regression tests cover import/export, UI wiring, malformed data and the delayed-read race. This is **partial**, not verified RStudio parity: live Pyodide/webR, physical Chromium file picker/download, independent nbformat acceptance and native cross-platform qualification are outstanding for this integrated revision. No hosted CI configuration changes were made.

## Browser R package management — 2026-10-23

The browser Packages pane now dispatches to the selected interpreter: Python
(Pyodide/micropip) or R (webR 0.6.0). The R session uses
`utils::installed.packages()` for inventory and `WebR.installPackages([name])`
for installation into the browser's active webR runtime. Commands are
serialized with source execution and environment inspection. Input is
restricted to package names, not arbitrary R expressions, URLs or paths.
Language switches, file/notebook imports and resets invalidate stale package
results; Flow package installation is unavailable in the browser.

**Evidence:** 16 isolated Node.js tests passed locally on 2026-10-23 against
the prepared R-session and package-panel modules, with mocked webR/Pyodide
interpreter interfaces. Tests are committed to PR #7 for cross-platform CI.
These tests verify API dispatch, serialization, invalid names, reset,
initialization failure cleanup and stale-response protection. They do **not**
prove actual package download, execution in Chromium, repository availability,
persistent installed libraries after reload, or macOS/Linux native parity.
The native Flow application remains the primary backend and is unchanged by
this browser-only feature. The Packages pane remains **partial**.

## Browser project file deletion — 2026-10-23

The draft Pages workspace adds an explicit **Delete open project file** action for browser-granted project directories. The explorer supplies the opened file's parent directory handle, so deletion can target nested files without traversing outside the granted project. The operation refuses dirty buffers, requires explicit confirmation, checks the on-disk baseline twice, and checks file-handle identity when `isSameEntry` is supported. Saves and deletes are mutually excluded. On successful removal, the editor retains the source as a detached, unsaved copy. Switching project folders detaches the previous active file handle.

**Evidence:** ten new regression cases in `tests/browser_project_delete.test.js` executed against the exact published modules using a V8 Node-compatible shim (10/10 passed). These cover successful removal, unsaved edits, external modification, replaced handles, cancellation, permission failures, save races, nested directories, project switching and browser UI wiring. The Node.js and native Flow cross-platform CI status for this revision must be checked separately; the V8 run is **not** physical-browser filesystem validation. Browser File System Access permission prompts and filesystem race windows between final check and `removeEntry` remain unverified. Rename, trash/undo and cross-browser file deletion are not implemented. The Flow 2.0 native server and CI definitions are unchanged.

## Browser Save As via native file picker — 2026-10-23

Draft PR #7 adds a browser-local Save As control using `showSaveFilePicker` when available.
It writes the selected handle with the existing 2 MiB bounded, conflict-aware
`writeIfUnchanged` implementation, preserves the old project file, confirms
replacement of a selected destination, and keeps the original editor association
when the picker is cancelled or a write fails. The active file's original disk
baseline is reused when the selected handle refers to that same file. Saves,
deletion, project switching and Save As are serialized by the workspace controller.
A successful Save As attaches the selected file for subsequent disk saves but
deliberately disables project-scoped deletion until the file is reopened through
the project explorer, because a native file picker does not expose a verified
parent directory handle.

**Validation:** nine local Node.js 22.16.0 tests passed for the new Save As
module against faithful copies of the existing file-save and filename validation
contracts. Additional workspace integration tests are committed; check the
current CI run separately before claiming cross-platform test success.
Physical-browser file-picker permissions, overwrite dialogs and real filesystem
race windows remain **unverified**. Browser file creation and writes are not
atomic compare-and-swap, and this is not full RStudio file-management parity.
The native Flow 2.0 server and hosted CI definitions are unchanged.


## Browser project source rename — 2026-10-23

The browser project workspace now exposes a rename operation for an active,
clean, project-scoped source file. It requires an explicitly granted parent
directory handle, validates the new filename, rejects an existing destination,
checks source handle identity and disk contents against the editor baseline,
confirms the requested operation, copies the source to a new handle, verifies
the copy, rechecks the original and then removes the old entry. On ambiguous
post-copy failure, both copies are retained for manual recovery; a failed
pre-copy write attempts to remove only its own unchanged empty destination.

**Status: partial / locally tested primitive; physical browser unverified.**
The 13 isolated Node.js regression tests passed locally on Node 22.16.0.
Additional workspace integration tests are committed and await hosted CI.
Browser File System Access has no atomic rename or compare-and-swap operation:
another actor can create the destination between the final lookup and creation,
or alter the original between the last comparison and removal. Do not use this
operation as an atomic transactional rename or on concurrently edited files.
The native Flow server is unchanged; Flow remains the primary native backend.

## Browser in-memory Python/R tabular inspection — 2026-10-23

The browser Environment pane now exposes **View** for Python DataFrame, NumPy
2D array, lists of rows/records, and R data.frame/matrix values. A serialized
kernel operation reads the selected variable by validated name (not arbitrary
user-supplied expressions) and returns a read-only snapshot capped at 200 rows,
32 columns, 160 characters per cell and 1 MiB of serialized data. The shared
table viewer provides filtering, column sorting and pagination; it renders
untrusted cells with textContent. Kernel reset and language changes invalidate
the visible snapshot. R queries use the existing webR evaluation queue and
Python uses the existing Pyodide worker queue.

**Status: partial, not RStudio parity.** Local CPython 3.11+ unit tests of the
real Python extraction helper passed 9/9 (NumPy 2.3.5, pandas 2.2.3); local Node 22.16.0 viewer tests
passed 2/2 against a mocked data API. The committed browser integration,
Python-worker protocol and webR query contracts are covered by new Node tests,
but actual live Pyodide/webR data extraction and physical Chromium interaction
are not yet independently verified. R extraction has not been run against an
installed R interpreter in this environment. This is a bounded snapshot viewer,
not an editable live DataFrame, database viewer, or native Flow table backend.
No hosted CI definition was changed.

## 2026-10-23: browser Python/R parse-only syntax diagnostics

The browser source toolbar now offers **Check syntax** without executing the user's code. Python requests are serialized through the persistent Pyodide worker and use `ast.parse`; R requests are serialized through the webR session and use `parse(text=...)` without evaluation. Syntax errors show a bounded message, line and column and move the editor caret to the location. Empty/oversized requests are refused and R session-reset responses are invalidated. The Flow compiler remains native-only; browser Flow syntax checks and language-server completion remain missing.

Validation: committed Node regression tests in `tests/browser_syntax_check.test.js` cover syntax-only dispatch, queue serialization, invalid diagnostics, R parse and reset races, and browser control wiring. A direct V8 mock-interpreter harness exercised the committed Python/R paths and HTML parsing, but no live Pyodide/webR browser run has yet been accepted. This is **partial**, not independently verified RStudio parity.
