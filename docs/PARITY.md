# FlowStudio RStudio parity matrix

**Baseline:** RStudio Desktop + Server core scientific IDE workflows. This is a goal and acceptance test list, not a claim of equivalence.

Legend: **unverified** = implementation exists but has not been built/executed in a validated environment; **partial** = explicitly narrower than baseline; **missing** = no implementation. A feature becomes **verified** only with repeatable end-to-end tests on macOS arm64 and Linux x86-64.

| Feature | 2026-10-15 state | Minimum acceptance criterion |
| --- | --- | --- |
| Four-pane IDE shell | unverified | Source, environment, console and plots render; keyboard/accessibility checks |
| File open / save | partial / conflict-aware browser saves and Save As picker wired; physical browser and native unverified | Native file-picker and download fallback round-trip UTF-8 |
| Flow source execution | partial / native Flow subprocess route integrated into browser IDE at /app/; physical-browser acceptance pending | Compile and run valid code; surface diagnostics for invalid code |
| R source execution | partial / browser webR 0.6.0 integrated, Node-mock tested; real webR unverified; native persistent R IPC and Flow-owned HTTP acceptance passed on Linux/macOS CI; physical-browser acceptance pending | Run via installed R; preserve state across evaluations |
| Python source execution | partial / native persistent CPython kernel added; local C IPC and Flow-owned HTTP tested in Linux/macOS CI; physical-browser acceptance pending | Run via installed Python; preserve state across evaluations |
| Editor selection execution | partial / Node-tested browser selection; native and physical-browser unverified | Selection runs without accidentally executing entire buffer |
| Persistent REPL/session | partial / browser Pyodide/webR sessions; native Python process retention and reset added (local C harness and cross-platform Flow HTTP CI passed); native R persistent kernel passed real Rscript and Flow-owned HTTP acceptance on Linux/macOS CI | Incremental variables and package state persist until reset |
| Interactive multi-language console | partial / Python and R browser sessions plus stateless native Flow full-program execution wired; per-language histories and unsent drafts implemented; 427/427 JS tests per platform and native Flow/HTTP CI passed on Ubuntu/macOS; live physical-browser acceptance pending | Console can execute selected Python/R/Flow independently of source editor; preserve Python/R state, histories and drafts; report Flow native-only limits and execution failures |\n| Variable inspector | partial / native Python and R bounded metadata snapshots cross-platform HTTP accepted; native Python exact-builtin nested metadata tree cross-platform CI accepted (unit/HTTP/DOM); R array dimensions and failed-lazy-binding recovery cross-platform HTTP accepted; browser Python/R metadata partial; arbitrary-object inspection and physical-browser acceptance missing | Nested objects / types / dimensions inspectable and refresh after execution |
| Plot viewer | partial / Node-tested PNG import and integrated workspace tab; native unverified | png/svg plot history, zoom, save and deterministic device lifecycle |
| Project explorer | partial / browser Pages open/create/save and confirmed active-file delete with baseline conflict checks; 10 regression tests V8-shim passed; physical-browser deletion unverified | Open project, tree navigation, source-file creation and save; scoped delete is implemented, copy-verify-delete rename implemented with non-atomic filesystem race limits; physical-browser acceptance remains missing |
| Data viewer | partial / CSV/TSV plus bounded Python/R environment table snapshots wired; real Pyodide/webR and physical browser unverified | Interactive sortable/filterable tabular datasets including missing values |
| Completion / language server | partial / browser Python/R runtime prefix completion cross-platform CI accepted; Flow source-local lexical completion accepted by Ubuntu/macOS CI (physical-browser unverified); Flow semantic/LSP/member completion and physical-browser acceptance missing | R, Flow and Python completion/diagnostics |
| Packages pane | partial / browser Python inventory/install and webR 0.6.0 inventory/install; mocked Node tests, live interpreters unverified | List, install, update with environment-aware package sources |
| Git pane | missing | Status, diff, stage, commit and branch operations |
| Help pane | partial / browser Python live-global/builtin docstrings and installed R Rd help wired; Node/V8 contract tests, live Pyodide/webR and physical browser unverified; Flow help missing | Context-aware language/function docs |
| Find / replace / cross-file search | partial / Node + V8-tested | Literal in-buffer find next/previous, single/all replacement and project-wide search implemented; incremental indexing, regex and physical-browser verification missing |
| Percent-delimited source cells | partial / lexical scanner unified across native editor and Pages, Node/HTTP acceptance pending; physical-browser execution unverified | Run only the active `# %%` code cell in Flow/R/Python; markdown and empty cells do not execute |
| Sequential percent-cell notebooks | partial / Python and R Run All wired with explicit per-cell Python/R/Flow language tags (cross-platform CI accepted; real browser pending); bounded browser-local text/Python PNG output recovery across reload; native and physical-browser acceptance unverified | Execute cells in order, retain interpreter state, show per-cell output and stop on error |
| Jupyter `.ipynb` import/export | partial / browser UI wired and Node regression coverage; bounded output recovery is separate from `.ipynb` import/export; physical-browser file round-trip and live Python/R kernels unverified | Import/export nbformat 4 Python/R code and Markdown cells through file picker/download; validate with nbformat; preserve source; verify live outputs in Chromium and cross-platform acceptance |
| R Markdown / Quarto | partial / offline HTML report export from Python/R percent-cell notebooks; no Quarto/R Markdown rendering | Render notebook with inline plots and HTML export; verify actual Quarto/R Markdown format compatibility |
| Source debugger | missing | Breakpoints, stack, variables, step execution |
| Remote/server mode | missing | Authenticated, origin-aware multi-user sessions with isolation |
| Diagnostics / profiling | partial / native CPython bounded line tracing cross-platform CI accepted; physical-browser acceptance pending | Resource/time tracing and useful language-specific diagnostics |
| Cross-platform packaging | missing | Installable signed/reproducible macOS and Linux releases |
| Accessibility | partial / unverified | Full keyboard navigation, screen reader labels, resize and contrast checks |
| RStudio project import | partial / browser-local .Rproj editor; Node-tested, native unverified | Open and preserve basic .Rproj project settings |

## 2026-10-24: independent browser console runtimes (cross-platform CI accepted)

The `docs/app/` interactive console now selects Python, R or Flow independently
of the source editor. It submits Python to the existing persistent Pyodide
worker, R to the existing persistent webR session, and full Flow programs
to the native Flow-owned execution route only when running on localhost.
Each console language has a separate bounded 100-command history and unsent
draft, with keyboard history navigation. A pending execution locks the console
language selector; runtime failures retain the source for correction. The
source editor's Reset action does not accidentally reset Python when Flow is
selected (Flow has no persistent console state). Existing native Flow compiler
syntax is unchanged.

**Status: partial / cross-platform CI accepted.** [PR #28](https://github.com/godofecht/FlowStudio/pull/28)
merged as [f47f710](https://github.com/godofecht/FlowStudio/commit/f47f710644bc4caf2eb61b3fadcd88c550499c4a)
after [CI #40083633240](https://github.com/godofecht/FlowStudio/actions/runs/40083633240)
passed all four jobs on Ubuntu 24.04 and macOS 14 (427/427 JavaScript tests
per platform, native Flow compilation and HTTP acceptance). The implementation
has not yet been exercised in a physical browser with real Pyodide/webR
downloads or the native Flow server. Flow console execution remains stateless and unavailable
on GitHub Pages. This is not a persistent Flow REPL or RStudio parity.

## 2026-10-24: mixed-language percent-cell notebooks (cross-platform CI accepted)

The GitHub Pages `docs/app/` editor and the Flow-owned native `/app/`
workspace now parse explicit `# %% [python]`, `# %% [r]`, and
`# %% [flow]` language markers while retaining source offsets and the
native/Pages parser's byte-for-byte equivalence. Run All dispatches
sequentially into the actual existing Pyodide/webR sessions, or the native
Flow endpoint for tagged Flow cells. The runner validates Flow availability
**before executing any cell**, stops on interpreter failures, and labels
cell output by the runtime used. Run Cell also respects tags; the
environment inspector targets the last completed Python/R kernel. Notebook
output recovery displays the language derived from the source marker.
Single-kernel `.ipynb` export rejects incompatible mixed-language cells
rather than mislabeling their runtime.

**Status: partial / cross-platform CI accepted; physical-browser execution
pending.** Local direct V8 checks passed for
language-tag parsing, sequential mixed-runtime dispatch, Flow preflight,
Jupyter export rejection and the updated workspace inline-script syntax.
`tests/browser_mixed_language_notebook.test.js` adds Node regression
coverage. PR #27 passed all four jobs in
[CI #40079407053](https://github.com/godofecht/FlowStudio/actions/runs/40079407053):
JavaScript regression tests and native Flow compilation/HTTP acceptance on
Ubuntu 24.04 and macOS 14. Merged as
[1db9441](https://github.com/godofecht/FlowStudio/commit/1db94418ac89a2b54c684101531500fa952fda22).
Python and R **do not share variables or objects**; there is no typed
cross-language data transfer. Flow compilation remains native-only,
per-cell, and does not preserve Flow variables across cells. Physical
Chromium/Safari interaction with real webR/Pyodide downloads is unverified.
See [MIXED_LANGUAGE_NOTEBOOKS.md](MIXED_LANGUAGE_NOTEBOOKS.md).

## 2026-10-24: Pages source find/replace (cross-platform CI accepted)

The GitHub Pages and native `/app/` editor now expose the existing
bounded literal search engine through an accessible source Find/Replace
panel. Ctrl/⌘+F and Ctrl/⌘+H focus the respective controls while the
source editor is focused; F3 and Shift+F3 navigate matches with wraparound.
Find, Replace, and Replace All preserve Unicode source and line endings;
edits dispatch the existing source `input` event, invalidating notebook
outputs and queuing the draft-save path. Search caps are 2 MiB source,
256-character query, 10,000 matches and 10,000-character replacement.
Replace All refuses truncated match sets and oversized results. The
native Flow-owned server explicitly allowlists both browser assets and
the HTTP smoke test exercises those routes.

**Status: partial / cross-platform CI accepted; physical-browser acceptance pending.**
The exact committed browser modules passed direct V8 functional checks of
forward/backward search, case sensitivity, single/all replacement,
input events, bounds and keyboard controls; the actual inline workspace
script parsed in V8. PR #26 passed all four jobs in
[CI #40075706074](https://github.com/godofecht/FlowStudio/actions/runs/40075706074):
Node regression and native Flow compilation/HTTP acceptance succeeded on
Ubuntu 24.04 and macOS 14. Merged as
[e8cb6af](https://github.com/godofecht/FlowStudio/commit/e8cb6afa9a0f3c38fbc0ee02cdb2542c610a4f08).
This is literal find/replace within a buffer, not regex find/replace or indexed
cross-file search; real Chromium/Safari interaction and RStudio editor parity
remain outstanding.

## 2026-10-24: native source-cell lexer parity (cross-platform CI accepted)

The native editor previously embedded an obsolete regular-expression-only
cell splitter while the Pages editor used a multiline-aware lexical scanner.
Consequently a `# %%` line inside Python triple-quoted text or an R
multiline string could execute the wrong source fragment on the native
Flow-owned server. The native `web/source_cells.js` now matches the Pages
`docs/app/source_cells.js` implementation, and `web/index.html` loads it
from an explicit `/source_cells.js` route in `src/data_routes.flow` instead
of embedding an untested stale copy. The lexer preserves CR, LF and CRLF
source offsets and caps the number of cells at 10,000. Regression suites
from superseded PR #6 are retained, with additional exact native/Pages
parity and native HTTP asset checks.

**Status: partial / cross-platform CI accepted, physical-browser acceptance
outstanding.** A direct V8 execution of the branch parser and its three test
modules passed 14 tests, and 174 focused assertions on parser equivalence and
route wiring passed on 24 October 2026. PR #25 subsequently passed all four
jobs in [CI #40071889990](https://github.com/godofecht/FlowStudio/actions/runs/40071889990):
Node tests and native Flow build/HTTP acceptance on Ubuntu 24.04 and macOS 14,
including native static-route and Run Cell regression checks. Merged as
[432104a](https://github.com/godofecht/FlowStudio/commit/432104af250dea1e056bf42bd4233162a74b204f).
An earlier macOS CI attempt encountered a TCP reset during an oversized-body
request; the acceptance harness now tests the transport's header-level 413
without racing a premature client body send against server early rejection.
Physical-browser and real interpreter Run Cell interaction remain unverified;
this does not establish RStudio parity.

## 2026-10-24: native Python execution trace (cross-platform acceptance pending)

FlowStudio's native Flow-owned `POST /api/trace/python` route now invokes
real `sys.settrace` instrumentation inside the **existing persistent CPython
kernel**. It records up to 256 executed lines, function names, timestamps and
up to 16 local variables per line; previews are restricted to exact built-in
scalars and do not invoke arbitrary `__repr__`. Output and JSON response
sizes are bounded, prior trace hooks are restored, and exceptions retain
structured trace output with HTTP 422. The native browser workspace renders
an accessible trace table with guarded source-line navigation. The package
script includes the helper, and existing Flow/C IPC and HTTP acceptance
harnesses now exercise the real trace operation.

**Status: partial / cross-platform CI accepted.** Five isolated CPython tests
and two Node trace-view tests passed in the authoring environment on
24 October 2026. PR #24 passed all four jobs in
[CI #40068293523](https://github.com/godofecht/FlowStudio/actions/runs/40068293523):
the Python/Node suites, real C IPC harness, native Flow compilation, live
Flow-owned HTTP acceptance and platform packaging succeeded on Ubuntu 24.04
and macOS 14. Merged as
[371d35b](https://github.com/godofecht/FlowStudio/commit/371d35b7ea9a5e2510ece2f654131a7f7b13e2ce).
Physical Chromium/Safari acceptance remains unverified; a local Chromium
attempt was blocked by the authoring environment's administrator policy.
GitHub Pages cannot invoke this native trace;
its Python runtime is a separate Pyodide session. This is an execution trace,
**not** an interactive debugger: breakpoints, stepping, stack controls,
R/Flow debugging and remote isolation remain missing. See
[PYTHON_TRACE.md](PYTHON_TRACE.md).

## 2026-10-24: Flow source-local symbol completion (cross-platform CI accepted)

The Pages `docs/app/` editor now uses the existing Ctrl+Space completion
controller to offer **Flow** source-local function/type/constant names,
explicit imported names, function parameters and currently open lexical
`let` bindings. The lexer masks hash comments and quoted strings; completion
does not evaluate source, launch Flow or contact a server. The 256 KiB source
limit and 64-name result limit bound editor work. A separate Node test file
exercises declarations matching real Flow 2.0 syntax, scopes, comments,
string literals, limits and editor insertion. Four cases passed a direct V8
execution check on 24 October 2026. PR #23 then passed all four jobs in
[CI #40064076010](https://github.com/godofecht/FlowStudio/actions/runs/40064076010):
Node regression suites and native Flow build/HTTP acceptance passed on Ubuntu
24.04 and macOS 14. Merged as
[c238a9a](https://github.com/godofecht/FlowStudio/commit/c238a9af6989c60a62bc5c48d287ce8115a20ef4).
Physical Chromium/Safari acceptance of the completion UI remains unverified.

**Status: partial.** This is not semantic completion or an LSP; no type-aware
members, cross-file imports, function signatures or compiler-backed symbol
resolution are claimed. Native Flow compilation remains the authoritative
syntax/type check. GitHub Pages still cannot compile or execute Flow natively.

## 2026-10-24: browser Python/R live symbol completion (pending acceptance)

The hosted `docs/app/` editor now offers **Ctrl+Space** or an explicit Complete
button for Python and R identifier prefixes. Python enumerates actual global
and builtin symbol **names** inside its persistent Pyodide worker; R enumerates
actual search-path symbol **names** inside the serialized persistent webR
session. Neither path evaluates the requested prefix, calls arbitrary object
methods or reads active-binding values. The UI renders text-only, bounded
(64-name) suggestions and inserts the selected name through the editor's
normal input/draft tracking. Stale completions are discarded when the source,
caret, language or session generation changes. The native Flow-owned server
explicitly allowlists the same browser module at `/app/completion.js`.

**Status: partial / cross-platform CI accepted.** PR #22 passed all four
jobs in [CI #40059915507](https://github.com/godofecht/FlowStudio/actions/runs/40059915507):
383/383 Node tests passed on both Ubuntu 24.04 and macOS 14, including
runtime-protocol mocks, editor insertion, stale-response and allowlist tests;
native Flow compilation, live HTTP acceptance and platform packaging also
passed. Merged as [a93facb](https://github.com/godofecht/FlowStudio/commit/a93facbd962b6971f388fa7065765ab521a2745c).
These are **not** real Pyodide/webR runtime completion or physical Chromium/Safari
acceptance tests. No Flow symbol completion, Python member completion, R `# FlowStudio RStudio parity matrix

**Baseline:** RStudio Desktop + Server core scientific IDE workflows. This is a goal and acceptance test list, not a claim of equivalence.

Legend: **unverified** = implementation exists but has not been built/executed in a validated environment; **partial** = explicitly narrower than baseline; **missing** = no implementation. A feature becomes **verified** only with repeatable end-to-end tests on macOS arm64 and Linux x86-64.

| Feature | 2026-10-15 state | Minimum acceptance criterion |
| --- | --- | --- |
| Four-pane IDE shell | unverified | Source, environment, console and plots render; keyboard/accessibility checks |
| File open / save | partial / conflict-aware browser saves and Save As picker wired; physical browser and native unverified | Native file-picker and download fallback round-trip UTF-8 |
| Flow source execution | partial / native Flow subprocess route integrated into browser IDE at /app/; physical-browser acceptance pending | Compile and run valid code; surface diagnostics for invalid code |
| R source execution | partial / browser webR 0.6.0 integrated, Node-mock tested; real webR unverified; native persistent R IPC and Flow-owned HTTP acceptance passed on Linux/macOS CI; physical-browser acceptance pending | Run via installed R; preserve state across evaluations |
| Python source execution | partial / native persistent CPython kernel added; local C IPC and Flow-owned HTTP tested in Linux/macOS CI; physical-browser acceptance pending | Run via installed Python; preserve state across evaluations |
| Editor selection execution | partial / Node-tested browser selection; native and physical-browser unverified | Selection runs without accidentally executing entire buffer |
| Persistent REPL/session | partial / browser Pyodide/webR sessions; native Python process retention and reset added (local C harness and cross-platform Flow HTTP CI passed); native R persistent kernel passed real Rscript and Flow-owned HTTP acceptance on Linux/macOS CI | Incremental variables and package state persist until reset |
| Variable inspector | partial / native Python and R bounded metadata snapshots cross-platform HTTP accepted; native Python exact-builtin nested metadata tree cross-platform CI accepted (unit/HTTP/DOM); R array dimensions and failed-lazy-binding recovery cross-platform HTTP accepted; browser Python/R metadata partial; arbitrary-object inspection and physical-browser acceptance missing | Nested objects / types / dimensions inspectable and refresh after execution |
| Plot viewer | partial / Node-tested PNG import and integrated workspace tab; native unverified | png/svg plot history, zoom, save and deterministic device lifecycle |
| Project explorer | partial / browser Pages open/create/save and confirmed active-file delete with baseline conflict checks; 10 regression tests V8-shim passed; physical-browser deletion unverified | Open project, tree navigation, source-file creation and save; scoped delete is implemented, copy-verify-delete rename implemented with non-atomic filesystem race limits; physical-browser acceptance remains missing |
| Data viewer | partial / CSV/TSV plus bounded Python/R environment table snapshots wired; real Pyodide/webR and physical browser unverified | Interactive sortable/filterable tabular datasets including missing values |
| Completion / language server | partial / browser Python AST and R parse-only syntax diagnostics; browser Python/R global-symbol prefix completion implemented with bounded interpreter namespace enumeration and keyboard insertion, pending cross-platform CI and physical-browser verification; native Flow strict compile-only diagnostics; Flow completion and member-aware completion missing | R, Flow and Python completion/diagnostics |
| Document outline | partial / browser line-scan symbol list for Flow, Python and R wired into the workspace with click-to-symbol; Node suites and headless-Chromium CDP run passed locally, cross-platform CI pending | List buffer symbols, navigate to them, and keep the outline in sync with the active buffer |
| Packages pane | partial / browser Python inventory/install and webR 0.6.0 inventory/install; mocked Node tests, live interpreters unverified | List, install, update with environment-aware package sources |
| Git pane | missing | Status, diff, stage, commit and branch operations |
| Help pane | partial / browser Python live-global/builtin docstrings and installed R Rd help wired; Node/V8 contract tests, live Pyodide/webR and physical browser unverified; Flow help missing | Context-aware language/function docs |
| Find / replace / cross-file search | partial / Node + V8-tested | Literal in-buffer find next/previous, single/all replacement and project-wide search implemented; incremental indexing, regex and physical-browser verification missing |
| Percent-delimited source cells | partial / browser Python Run Cell integrated; Node and real-browser validation pending; Flow browser execution unavailable; browser R unverified | Run only the active `# %%` code cell in Flow/R/Python; markdown and empty cells do not execute |
| Sequential percent-cell notebooks | partial / Python and R Run All wired; bounded browser-local text/Python PNG output recovery across reload; native and physical-browser acceptance unverified | Execute cells in order, retain interpreter state, show per-cell output and stop on error |
| Jupyter `.ipynb` import/export | partial / browser UI wired and Node regression coverage; bounded output recovery is separate from `.ipynb` import/export; physical-browser file round-trip and live Python/R kernels unverified | Import/export nbformat 4 Python/R code and Markdown cells through file picker/download; validate with nbformat; preserve source; verify live outputs in Chromium and cross-platform acceptance |
| R Markdown / Quarto | partial / offline HTML report export from Python/R percent-cell notebooks; no Quarto/R Markdown rendering | Render notebook with inline plots and HTML export; verify actual Quarto/R Markdown format compatibility |
| Source debugger | missing | Breakpoints, stack, variables, step execution |
| Remote/server mode | missing | Authenticated, origin-aware multi-user sessions with isolation |
| Diagnostics / profiling | missing | Resource/time tracing and useful language-specific diagnostics |
| Cross-platform packaging | missing | Installable signed/reproducible macOS and Linux releases |
| Accessibility | partial / unverified | Full keyboard navigation, screen reader labels, resize and contrast checks |
| RStudio project import | partial / browser-local .Rproj editor; Node-tested, native unverified | Open and preserve basic .Rproj project settings |

 /
`::` completion, LSP, signature help or remote completion exists yet.
The legacy native `web/index.html` editor has not been migrated to this
controller. This does not qualify RStudio editor parity.

## 2026-10-24: native Python nested environment tree (CI pending)

The existing Flow-owned `POST /api/inspect/python` endpoint now returns
bounded child metadata for **exact** built-in Python `dict`, `list`, and
`tuple` objects. At most two child levels, twelve children per container,
256 total nodes, 128 root variables and 64 KiB of serialized JSON are
returned. Keys are rendered only for exact strings and bounded integers;
user-defined `__repr__`, `__str__`, `__len__`, `__iter__`,
`__getitem__`, properties, and descriptors are never invoked by this
inspection traversal. The native editor renders a keyboard-expandable
`<details>` tree with text-only DOM nodes. It reports truncation and does
not attempt to inspect pandas, numpy, user objects, or R list elements.

**Status: partial / cross-platform CI accepted.** PR #20 passed all four jobs in
[CI #40051484731](https://github.com/godofecht/FlowStudio/actions/runs/40051484731):
Python unit tests cover nesting, malicious objects, truncation and cycles;
native HTTP smoke tests exercise the actual persistent Python process through
Flow routing; Node tests check the native editor renderer. Real FlowStudio
native builds and HTTP acceptance passed on Ubuntu 24.04 and macOS 14.
Merged as [eb87f6c](https://github.com/godofecht/FlowStudio/commit/eb87f6caaf834b0db58c75927ffe26632a600b4a).
Physical-browser accessibility and arbitrary-object inspection remain unverified.

## 2026-10-24: sequential native Flow notebook execution (pending acceptance)

The existing `docs/app/` percent-cell notebook runner now supports Flow only
when the browser is served from FlowStudio's exact loopback origin
(`http://127.0.0.1:8751/app/` or `localhost`). Each Flow code cell is a
complete, **independently compiled and executed** program dispatched in order
to the existing Flow-owned `POST /api/run/flow` endpoint. The runner retains
its 64 KiB/cell, 128 executable-cell and 1 MiB aggregate output limits,
stops on compiler/runtime errors, skips Markdown, and stores bounded output
for exact-source browser recovery. There is no cross-cell Flow state or Flow
variable inspector; Python and R retain their existing persistent runtimes.
The GitHub Pages build cannot run native Flow, and Flow is not yet supported
by the Jupyter notebook exporter.

**Status: partial / cross-platform CI accepted.** PR #19 passed all four jobs in
[CI #40046843234](https://github.com/godofecht/FlowStudio/actions/runs/40046843234),
including 356 Node tests on each platform, actual native Flow compiler builds
and HTTP acceptance on Ubuntu 24.04 and macOS 14; merged as
[561b8c0](https://github.com/godofecht/FlowStudio/commit/561b8c0d1bcc46556750406a653118adcb55ddd5).
The Node integration tests exercise real `native_flow.js` client request
construction, sequential dispatch, compiler failure propagation and GitHub
Pages denial with mocked HTTP responses; they are **not** physical-browser
acceptance. A physical browser running the entire Flow notebook workflow is
still unverified. Do not count this as RStudio notebook parity.

## 2026-10-24: native R environment metadata inspection (cross-platform HTTP accepted)

The Flow-owned localhost server now exposes intent-gated `POST /api/inspect/r`, backed by an `I` opcode in the persistent Rscript process. A bounded JSON response reports at most 128 variable names, R storage types, and base-vector lengths; active bindings are reported without evaluating their functions. The native editor refreshes the R environment after execution and reset and supports manual refresh. Output uses DOM `textContent`, not executable HTML. C IPC harness, live Flow HTTP acceptance, Node UI regression tests and protocol wiring tests were extended.

**Status: partial / cross-platform native HTTP accepted.** PR #14 passed all four jobs in [CI #40041613069](https://github.com/godofecht/FlowStudio/actions/runs/40041613069), including real Rscript IPC and Flow-owned HTTP acceptance on Linux x86-64 and macOS arm64; merged in [ba263fe](https://github.com/godofecht/FlowStudio/commit/ba263fef307947f567b6e3d5969d2433a04bb44f). Physical-browser acceptance remains missing. R lazy promises may be forced by base `get()` during inspection; this is not a side-effect-free debugger, recursive viewer, or remote isolation. The local server still runs arbitrary submitted code with the user's permissions.

## 2026-10-24: R array dimensions and inspection failure recovery (cross-platform HTTP accepted)

The persistent R inspector now reports bounded integer dimensions for base matrices and arrays using the raw `dim` attribute rather than dispatching user-defined `dim()` methods. The native environment table displays validated shapes such as `2 × 3`; other variables retain their original size metadata. Failed lazy promises are reported as `unavailable` rather than crashing the IPC loop, while active bindings remain unevaluated. Native C/R IPC tests cover a matrix, a failing promise and subsequent kernel reuse; HTTP acceptance checks shape metadata, and the Node DOM suite checks shape rendering.

**Status: partial / cross-platform native HTTP accepted.** PR #15 passed all four jobs in [CI #40042224649](https://github.com/godofecht/FlowStudio/actions/runs/40042224649), including actual Rscript IPC, Flow compilation and live HTTP acceptance on Ubuntu 24.04 and macOS 14; merged in [68e6980](https://github.com/godofecht/FlowStudio/commit/68e6980c14a61378f739d07a998ebe27d25677c8). No local Rscript or Flow compiler was available on the editing host. Physical-browser acceptance remains outstanding; inspection may still force non-failing lazy promises.

## 2026-10-23: native persistent R session (cross-platform HTTP accepted)

The Flow-owned localhost `POST /api/run/r` route now dispatches to a persistent `Rscript --vanilla` kernel using bounded length-framed stdin/fd3 IPC. Top-level expressions are parsed and evaluated in a retained R environment, with visible values, output, warnings and errors captured. Exceptions return HTTP 422 without discarding existing variables; `POST /api/reset/r` terminates the process group and starts a fresh environment on next use. Requests have a 128 KiB source/output limit and a 15-second deadline; disconnected or timed-out kernels are killed and reset. The native editor has an explicit Reset R control, and release packaging includes the R kernel.

**Status: partial / cross-platform native HTTP accepted.** PR #13 passed all four jobs in [CI #40035736325](https://github.com/godofecht/FlowStudio/actions/runs/40035736325), including real Rscript persistence, error recovery, reset, bounded output and timeout recovery through C IPC, followed by Flow-owned HTTP acceptance on Linux x86-64 and macOS arm64. The R harness initially failed because `cat(value, '\\n')` emits a separator space; the test was corrected to request `sep=''` explicitly and both platforms then passed. Physical-browser acceptance, R environment inspection, package lifecycle, plots and asynchronous interruption remain missing. R code executes with the local user's permissions; this is not sandboxed or remote-session functionality.

## 2026-10-23: native Python environment inspection (cross-platform HTTP accepted)

The Flow-owned localhost server exposes intent-gated `POST /api/inspect/python`, using a dedicated inspect opcode over the existing persistent CPython process IPC. Inspection reads namespace metadata without compiling/evaluating submitted source or invoking arbitrary object repr, len, property getters or user-defined methods. Responses contain at most 128 user variables with bounded names, type names and sizes for exact built-in containers; a truncation flag identifies limits. The native editor refreshes this table after execution and reset, with DOM text-only rendering and stale-response protection.

**Status: partial / cross-platform native HTTP accepted.** PR #12 passed all four jobs in [CI #40022927098](https://github.com/godofecht/FlowStudio/actions/runs/40022927098): 341 JavaScript tests passed on each platform, Python metadata tests and C IPC harness passed, and the Flow-owned native server compiled and passed live HTTP inspection tests on Linux x86-64 and macOS arm64. Real browser DOM acceptance and native R inspection remain missing. This is a local single-session view, not recursive inspection, rich object preview, or RStudio Server parity.

## 2026-10-23: native persistent Python session (in-progress acceptance)

The Flow-owned loopback `POST /api/run/python` route now delegates to a single persistent CPython process, with Flow controlling dispatch and the POSIX shim handling framed stdin/fd3 IPC, process-group termination, bounded 128 KiB output and a 15-second per-evaluation deadline. `POST /api/reset/python` discards variables and restarts the kernel on its next use. The native editor includes a Reset Python control. Exceptions return HTTP 422 without losing variables; a timeout or kernel disconnection kills the process group and discards state. The Python runner is packaged with the native binary.

**Status: partial / cross-platform CI-tested.** A real local C/Python harness passed state persistence, exception recovery, reset, output truncation and timeout restart. CI run [#40014862098](https://github.com/godofecht/FlowStudio/actions/runs/40014862098) passed all four jobs on Linux x86-64 and macOS arm64 (Ubuntu native HTTP required a rerun after an unrelated cold Flow subprocess exceeded 60 seconds). The real Flow 2.0.0 router compiled, executed the native Python HTTP persistence/reset acceptance cases, and produced platform packages. Physical-browser acceptance is **not yet verified**. Python runs with the local user's permissions and is not sandboxed; this is single-session localhost functionality, not remote or multi-user RStudio Server parity. Native R persistence, Python environment inspection, debugger, asynchronous interruption and session persistence across server restarts remain missing.

## 2026-10-23: nonexecuting native Flow syntax and type checks

The browser editor's Check syntax action now calls the Flow-owned loopback endpoint `POST /api/check/flow` only when loaded from the native FlowStudio origin. The Flow server writes the submitted source to a private temporary file and invokes the documented `flow tool compiler/scripts/flowc_emit.flow --strict IN.flow OUT.c` compiler path. It removes both temporary files after the process completes, does not link the emitted C, and never executes the submitted Flow program. The same intent/origin/body checks and 60-second process-group deadline as native Flow execution apply. Compiler errors are surfaced in the console, with source-position navigation when flowc supplies file:line:column diagnostics.

**Status: partial / unverified on live compiler.** Node client regression tests and a native HTTP acceptance case have been added; CI must establish actual strict Flow compilation on Linux and macOS. Browser DOM and physical-browser acceptance remain outstanding. This is not language-server completion or a debugger. Compilation of untrusted source still invokes a local compiler under the user's permissions and should not be exposed remotely.

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

A Flow 2.x application in src/main.flow delegates only POSIX socket handling and temporary-file operations to src/http_bridge.c. Flow execution uses bounded subprocesses; native Python and R each use a bounded persistent kernel with reset (Python additionally supports metadata inspection). The browser workspace provides a text editor, selection execution, console output, and file opening/saving.

The present slice is intentionally NOT a full RStudio-compatible UI, a secure remote server or a complete plotting workstation. It binds to loopback only. Executed programs retain all the permissions of the user running the server. It must not be exposed to remote users or run with elevated privileges.

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

## 2026-10-23: notebook output crash recovery

The browser notebook now writes completed Python/R cell text outputs and bounded Python PNG plot captures to browser-local storage after each cell. On reload it restores outputs only when the source text and language exactly match; it does not re-execute cells or pretend to restore interpreter variables. New notebook execution, source edits, language changes, file changes, imports and session reset clear the saved output snapshot. Stored data are schema-validated and limited to 1 MiB total, 128 code cells, 128 KiB source and 128 KiB output per cell. The recovered results can be exported through existing .ipynb/HTML report routes when source matches. R ImageBitmap plot objects are not serializable and are intentionally not persisted.

**Status: partial.** Added Node regression tests for exact-source recovery, failed cells, bounds, tampering, storage errors and workspace wiring. Local V8 execution with a UTF-8 encoder shim passed nine assertions and parsed the actual browser inline script. Native Flow/R/Python interpreter state persistence, IndexedDB project-scoped history, live Pyodide/webR acceptance and physical-browser reload acceptance remain unverified or missing. Browser storage can be cleared by the user or browser.

## 2026-10-24: native R nested plain-list inspection (CI pending)

The Flow-owned persistent R inspector now includes bounded child metadata for
**ordinary unclassed R lists** through the existing intent-gated
`POST /api/inspect/r` endpoint. It descends at most two child levels,
returns up to twelve children per container and 256 children per inspection,
and respects the existing 65 KiB JSON response budget. The native editor uses
its existing text-only, keyboard-expandable environment tree for R as well as
Python. Classed/S3/S4 objects are not traversed; active bindings are not
read, and the inspector does not call user-defined print or indexing methods.

**Status: partial / CI pending.** A real Rscript-backed IPC harness now checks
nested values, classed-list method avoidance and truncation; the Flow-owned
HTTP smoke suite checks nested R metadata, and the Node DOM suite checks
rendering. These tests are committed but are **not yet claimed passing**.
The inspector can still force ordinary lazy R promises during root binding
lookup, and the physical-browser workflow has not been independently accepted.
This is not full RStudio environment inspection parity.

