## 2026-10-27: bounded typed Python/R tabular interchange (validation pending)

The browser-local Copy variable path now accepts a **typed table packet** with
1–16 unique ASCII column names and 0–128 rows, equal-length columns, only
number/boolean/string types, and per-column missing values. Total encoded
JSON remains limited to 32 KiB. Exact Python built-in dictionaries of
homogeneous plain list/tuple columns export as R data.frames; plain base R
data.frames with default row names and unclassed atomic columns export as
Python dictionaries of lists. The existing scalar/vector protocol and native
Flow-owned server routes are unchanged. No new interpreter or demo backend
was added.

**Status: partial / independently verified Linux/macOS source and native
CI; physical-browser Pyodide/webR execution remains unverified.**
[PR #92](https://github.com/godofecht/FlowStudio/pull/92) merged as
[9ee78f7](https://github.com/godofecht/FlowStudio/commit/9ee78f7a56a3b6a0054db5e1d53dcc285e17c960)
after [CI #40428898996](https://github.com/godofecht/FlowStudio/actions/runs/40428898996)
passed all four Ubuntu 24.04/macOS 14 jobs. Each source job ran 812
JavaScript tests (808 passed, four skipped, zero failed). Both native
jobs compiled Flow 2.0.0, passed live Rscript/HTTP acceptance and packaged
the executable. All six new table tests passed without skips on both native
platforms, including actual CPython and Rscript round trips and rejection
cases. The native verification harness requires real Rscript table acceptance
rather than treating an optional local Rscript skip as passing evidence. Python
empty-column dictionaries and all-None columns cannot be typed and are
rejected; R zero-row typed data.frames can be transferred one-way to Python.
Factors, custom row names, dates, pandas DataFrames, nested objects, nonfinite
numbers and unsafe names remain unsupported. R integer storage is not
preserved on import. This is not Arrow/pandas compatibility, remote-session
isolation, knitr rendering, function-level R debugging or RStudio parity.


## 2026-10-26: typed R NA / Python None vector transfer (Linux/macOS CI passed)

The browser-local Python ↔ R transfer now preserves missing values in typed
vectors. Homogeneous Python lists/tuples may contain `None`; R classless atomic
vectors may contain type-specific `NA`. R integers still map to numeric wire
values and import as R doubles. Transfers retain the 256-item / 32-KiB bounds.
Scalar `None`, all-`None` Python lists (untyped), heterogeneous nonmissing
values, NaN, Inf, classed R objects and tables remain rejected. The R literal
string `"@NA@"` remains distinct from its missing-value wire sentinel.

**Status: partial / independent Linux/macOS source and native CI passed.**
[PR #91](https://github.com/godofecht/FlowStudio/pull/91) merged as
[7612894](https://github.com/godofecht/FlowStudio/commit/761289493953cfd075e72dd304fb4e7b51eaeacd)
after [CI #40422754617](https://github.com/godofecht/FlowStudio/actions/runs/40422754617)
passed all four jobs. Each source job ran 806 JavaScript tests (803 passed,
three skipped, zero failures), Python suites and C transport checks. Both
native jobs compiled Flow 2.0.0, passed real Rscript/HTTP acceptance and
packaging. All five new transfer tests passed without skips on both native
platforms, including real Rscript NA/NaN/Inf and literal sentinel assertions.
Eight direct V8 protocol assertions also passed locally. The opt-in
Playwright runner includes real Pyodide → webR → Pyodide NA/None round-trip
assertions, but physical-browser execution is **not yet verified**.
No hosted CI configuration or native Flow route changed. This is not
tabular interchange, restart-persistent interpreters, live function-level
R debugging, authenticated remote sessions or RStudio parity.

## 2026-10-26: prevent implicit knitr execution from Markdown cells (Linux/macOS CI passed)

R Markdown export rejects executable fenced knitr chunks and inline R
expressions embedded in FlowStudio **Markdown** cells. Such cells are inert in
the editor, but knitr would otherwise execute their contents after .Rmd export.
Literal `eval=FALSE` R/Python fenced chunks remain portable and inert;
ordinary fenced examples and escaped inline examples remain Markdown.
The exporter refuses unknown knitr options instead of silently changing
execution semantics. This change affects `docs/app/` export only; it does not
execute R, install knitr, or introduce a new backend.

**Status: partial / independent Linux/macOS source and native CI passed.**
[PR #90](https://github.com/godofecht/FlowStudio/pull/90) merged as
[8930d49](https://github.com/godofecht/FlowStudio/commit/8930d495bde1edec62df289e8527960f830a9b81)
after [CI #40415902244](https://github.com/godofecht/FlowStudio/actions/runs/40415902244)
passed all four jobs on Ubuntu 24.04 and macOS 14. Each source job ran
801 JavaScript tests (799 passed, two skipped, zero failures), 78 Python
tests (11 skipped), and transport checks. Both native jobs compiled the
real Flow 2.0.0 server, passed live Rscript/HTTP acceptance and packaged it.
Four new Node regression cases and 12 direct V8 assertions passed. Physical-
browser R Markdown export and real knitr rendering remain unverified or
unimplemented. No hosted CI configuration changed; RStudio parity is not achieved.

## 2026-10-26: real browser R named-list member completion (Linux/macOS CI passed)

The `docs/app/` browser workspace now completes named members of ordinary R
lists from **real webR or native R inspector snapshots** through the existing
serialized `getRSession().inspect()` path. The Flow-owned native route is
`POST /api/inspect/r`; the webR path uses its existing bounded inspection
query. `analysis$model$sc` offers inspected `scale`/`score` children
without replacing the receiver; `$` works with an empty prefix. Existing
Python/R root completion and Flow lexical completion are unchanged. No new
interpreter or simulated response was introduced.

The list traversal is bounded to the first twelve children per container and
two nested member levels. It rejects unsafe or reserved identifiers, malformed
labels, active bindings and classed objects without child metadata; it does
not evaluate submitted completion expressions. **The underlying native R
inspector can still force lazy promises during root binding lookup**, so this
is not side-effect-free for all possible R workspaces.

**Status: partial / independent Linux/macOS source and native CI passed.**
[PR #88](https://github.com/godofecht/FlowStudio/pull/88) merged as
[5895687](https://github.com/godofecht/FlowStudio/commit/589568749c0e64b45ced52be9570852d2f470478)
after [CI #40408659163](https://github.com/godofecht/FlowStudio/actions/runs/40408659163)
passed all four jobs on Ubuntu 24.04 and macOS 14. Each source job ran
797 JavaScript tests (795 passed, two skipped, zero failures) and 78 Python
tests (11 skipped). Both native jobs compiled the real Flow 2.0.0 server,
passed Rscript/HTTP acceptance and packaged the executable. Direct V8
execution of the actual browser completion module, inspected-member dispatch
and insertion also passed locally. These gates do **not** establish a physical
browser webR/Rscript completion pass; that interaction remains unverified. The separate native Monaco provider is under
[draft PR #89](https://github.com/godofecht/FlowStudio/pull/89);
its checked-in `web/ui/workbench.js` bundle still needs regeneration and
physical-browser acceptance before the native Monaco feature can ship.
No Flow compiler, HTTP route or hosted CI configuration changed.
This is not data.frame column completion, knitr rendering, function-level
R debugging, authenticated remote sessions or RStudio parity.

## 2026-10-26: clear saved notebook outputs without resetting interpreters (validation pending)

The browser workspace now offers **Clear cell output** and **Clear all outputs**
for saved code-cell results. Clearing the selected code cell leaves other code
results and Markdown cards intact; clearing all removes saved code results
without changing source or the persistent Python/R kernel state. Both actions
reject active execution, stale source/language and unsupported Markdown
selection. The browser-local recovery record is invalidated and, when any
results remain, rewritten with only those results. Subsequent .ipynb, .fsnb
and HTML exports cannot reintroduce cleared outputs. Failed persistence is
reported explicitly. No backend routes, Flow compiler or hosted CI changes.

**Status: partial / PR #87 merged as fc23e427 after all four
Ubuntu 24.04/macOS 14 jobs in CI #40399045181 passed.** Seven Node
regressions were added; physical-browser acceptance remains unverified. This is output
management, not interpreter state recovery, real knitr rendering, resumable
function-level R debugging, authenticated remote sessions or RStudio parity.

## 2026-10-26: portable .fsnb v2 retains safe Jupyter output records (new PR; validation pending)

Portable FlowStudio notebook export now emits v2 only when a cell has validated
Jupyter output records. The v2 decoder preserves ordered stdout/stderr streams,
real error tracebacks, bounded text/plain results and PNG display data for
later .ipynb export. Ordinary snapshots remain v1 and existing v1 files
continue to import. Records must exactly match the displayed snapshot; altered,
active HTML/SVG, noncanonical metadata and Flow-cell Jupyter provenance are
rejected. This is **display-only file persistence**, not interpreter state
restoration or full Jupyter compatibility. The Flow native backend and hosted
CI are unchanged.

**Status: partial / independent Linux/macOS source and native CI passed;
physical-browser import/export remains unverified.** [PR #86](https://github.com/godofecht/FlowStudio/pull/86)
merged as [b8b65b6](https://github.com/godofecht/FlowStudio/commit/b8b65b6eee1eb3298da40094668b96dfa2a515c6)
after [CI #40390075606](https://github.com/godofecht/FlowStudio/actions/runs/40390075606)
completed all four Ubuntu 24.04/macOS 14 jobs successfully, including native
Flow 2.0.0 compilation, real Rscript/HTTP acceptance and packaging.
Actual knitr rendering, function-level R debugging, authenticated remote
sessions and RStudio feature parity remain outstanding.

## 2026-10-26: Jupyter output records survive bounded browser reload recovery (local validation only)

The existing browser-local notebook recovery now retains validated, inert Jupyter
output records alongside displayed snapshots. On a matching source/language
reload, exporting .ipynb can preserve stdout/stderr ordering, error tracebacks,
plain-text display results and bounded PNG output instead of flattening them.
The recovery path uses the same canonical validator as .ipynb import/export,
rejects mismatched or unsupported records, and preserves compatibility with
older v1 recovery entries that contain only flattened output. Storage retains
the existing 1 MiB total limit and exact source/language match; no interpreter
state is restored or code executed. A failed write leaves the previous stored
record intact. Portable .fsnb remains snapshot-only.

**Status: partial / independent Linux/macOS source and native CI passed;
physical-browser reload/export still unverified.** [PR #85](https://github.com/godofecht/FlowStudio/pull/85)
merged as [8726160](https://github.com/godofecht/FlowStudio/commit/87261600f74c1780c8585256fa0a297de9c68bff)
after [CI #40381335618](https://github.com/godofecht/FlowStudio/actions/runs/40381335618)
passed all four Ubuntu 24.04/macOS 14 jobs. Each source job completed
752 JavaScript tests (750 passed, two skipped, zero failures), plus 78 Python
tests (11 skipped). Both native jobs compiled Flow 2.0.0, passed live
Rscript/HTTP acceptance and packaged the native executable. Eight focused
recovery tests also passed in a local V8 harness with Node built-in shims;
this is not an independent physical-browser pass. Post-merge main validation
remains unconfirmed. This is not evidence of real Pyodide/webR browser
execution, knitr rendering, live R function debugging, authenticated remote
sessions or RStudio parity. The Flow native backend and hosted CI are unchanged.

## 2026-10-26: loss-aware Jupyter output record round-trip (Linux/macOS CI passed)

The browser notebook importer now retains the original **safe, inert Jupyter
output types** (ordered stdout/stderr streams, genuine error type/message and
traceback, text/plain display data, and bounded PNG display data). Immediate
.ipynb export preserves their order and output semantics while explicitly
clearing historical execution counts and discarding unsupported metadata.
Previously, all text was collapsed into a single stdout/stderr stream and
failed-cell traceback records were exported as ordinary stderr, losing
Jupyter's error semantics. Imported source and output are never executed.

Preservation is **conditional on exact agreement with the bounded displayed
snapshot**. Unsupported HTML/SVG/widgets, oversized/truncated output or
tampered snapshots cannot be exported as trusted Jupyter records; unsupported
records fall back to the existing inert preview representation with the
import loss notice. Source edits clear the snapshot. Browser recovery and
portable .fsnb files still retain only flattened display snapshots, so a
page reload does not promise preservation of individual Jupyter record types.

**Status: partial / independently verified Linux/macOS source and native CI;
physical-browser import/export pending.** [PR #84](https://github.com/godofecht/FlowStudio/pull/84)
merged as [1aca6a1](https://github.com/godofecht/FlowStudio/commit/1aca6a16ed5997aea2d28f9e987fc152e66aaaee)
after [CI #40371879210](https://github.com/godofecht/FlowStudio/actions/runs/40371879210)
passed all four Ubuntu 24.04/macOS 14 jobs. Each source job ran 750
JavaScript tests (748 passed, two skipped, zero failures), including four new
output-fidelity regressions, and 78 Python tests (11 skipped). Both native
jobs compiled Flow 2.0.0, passed real Rscript/HTTP acceptance and completed
packaging. Sixteen Jupyter output test cases also passed against the changed
modules in a local V8 harness. This is not evidence of physical-browser
import/export or actual knitr rendering. No Flow backend, interpreter route,
hosted CI or compiler changed. Live R function debugging, knitr rendering
and authenticated remote sessions remain outstanding; RStudio feature parity
is not achieved.

## 2026-10-26: notebook execution through the current caret cell (validation pending)

The browser notebook toolbar now offers **Run through here**, executing the
inclusive source-cell range from the beginning of the buffer through the cell
containing the caret. It dispatches actual Flow/R/Python code to the same
existing kernels as **Run all cells** and **Run from here**, renders intervening
Markdown without executing it, and never evaluates later cells. Flow preflight,
128 executable-cell and 64 KiB per-cell limits apply to the selected range
only; execution stops on the first interpreter failure. Invalid/reversed ranges
are rejected before contacting an interpreter. The current run's output and
saved snapshots refer only to executed cells. Existing **Run cell** still
executes its cell in the console rather than the notebook results pane.

**Status: partial / independently verified Linux/macOS source and native
CI; physical-browser acceptance pending.** [PR #83](https://github.com/godofecht/FlowStudio/pull/83)
merged as [38b83d3](https://github.com/godofecht/FlowStudio/commit/38b83d3e5f892c301bbf2c59a92bb05356b9c916)
after [CI #40362319668](https://github.com/godofecht/FlowStudio/actions/runs/40362319668)
passed all four Ubuntu 24.04/macOS 14 jobs. Each source job ran 746
JavaScript tests (744 passed, two skipped, zero failures), including eight new
range-execution regressions, and 78 Python tests (11 skipped). Both native
jobs compiled the pinned real Flow 2.0.0 backend, passed live Rscript/HTTP
acceptance and completed packaging. Twenty-six actual-source V8 assertions
also passed locally using Node builtin shims. These native tests do not
establish physical-browser run-through-caret behavior: real Pyodide/webR
interaction and post-merge `main` validation remain unverified. This adds
no new execution backend, remote-session isolation or RStudio feature parity.
Hosted CI is unchanged.

## 2026-10-26: bounded native R multi-page preview CSV export (verification pending)

The environment table viewer can now export all **preview rows** of a native
GNU R data.frame/matrix via the existing Flow-owned POST /api/table/r route.
It starts at row zero, follows the kernel's exact nextOffset across
response-size-shortened pages, and writes a single CSV header with rows in
kernel order. It refuses gaps, empty intermediate pages, inconsistent schemas
or row counts, more than 25,000 rows, more than 512 pages, and more than 8 MiB
of UTF-8 CSV. Existing formula escaping applies to every page. No partial
file is downloaded after an error or view closure. The current visible slice,
local filtering and local sorting are not changed; those operations are not
misrepresented as global.

**Status: partial / independently verified Linux/macOS source, native
Flow 2.0.0 compilation, real Rscript/HTTP acceptance and packaging;
physical-browser CSV interaction unverified.** [PR #82](https://github.com/godofecht/FlowStudio/pull/82)
merged as [0867704](https://github.com/godofecht/FlowStudio/commit/0867704f7decc31182d09830df5ef84d71df5d3e)
after [CI #40352789712](https://github.com/godofecht/FlowStudio/actions/runs/40352789712)
passed all four Ubuntu 24.04/macOS 14 jobs. Each source job ran 738
JavaScript tests (736 passed, two skipped, zero failures) and 78 Python
tests (11 skipped). Both native jobs compiled the real Flow 2.0.0 backend,
passed live Rscript/HTTP acceptance and completed packaging. The opt-in
Playwright suite contains a 251-row real native R CSV-download assertion,
but that physical-browser scenario has **not** been independently run.
The existing R kernel only returns the first 32 columns and at most 160
characters per cell; exports are not full-fidelity raw R datasets and
cannot guarantee atomic consistency if R data mutate between requests.
No native backend routes, compiler or hosted CI configuration changed.
Full RStudio parity, live function-level R debugging and authenticated
remote sessions remain outstanding.

## 2026-10-26: direct native R table row navigation (verification pending)

The browser environment table viewer can jump directly to a specified 1-based
row of a native GNU R data.frame or matrix. It uses the existing Flow-owned
`POST /api/table/r` route and persistent kernel with a literal variable name
and exact bounded row offset, even when a 65 KiB response limit shortens a
slice. Rows already loaded navigate locally. Previous-page navigation restores
the prior slice and browser page; invalid, out-of-range and non-decimal row
inputs are rejected before HTTP. The jump control is not shown for Python or
webR preview-only snapshots. At most 128 previous slice positions are kept.
Sorting, filtering and CSV export remain explicitly limited to the loaded
slice; no complete dataset export or new native route is introduced.

**Status: partial / independently verified Linux/macOS source tests,
native Flow 2.0.0 compilation, real Rscript/HTTP acceptance and packaging;
physical-browser direct-row interaction still unverified.**
[PR #81](https://github.com/godofecht/FlowStudio/pull/81)
merged as [45ef85e](https://github.com/godofecht/FlowStudio/commit/45ef85e94c94329c360ac8664e5cd0754d9a7f12)
after [CI #40343594736](https://github.com/godofecht/FlowStudio/actions/runs/40343594736)
passed all four Ubuntu 24.04/macOS 14 jobs. Each source job completed
730 JavaScript tests (728 passed, two skipped, zero failures) and 78 Python
tests (11 skipped). Both native jobs built the real Flow-owned backend,
passed Rscript/HTTP acceptance and completed packaging. The opt-in
physical-browser jump scenario has **not** been executed; existing HTTP
acceptance is not evidence that the new UI interaction works in Chromium.
Flow 2.0.0 remains the primary backend. No hosted CI changes.
This is not live R function-level debugging, authenticated remote sessions
or RStudio parity.

## 2026-10-26: persistent native R table paging (validation pending)

The existing Flow-owned `POST /api/table/r` route now accepts a literal R
workspace variable name and an optional decimal row offset. The real
persistent GNU R kernel returns a bounded page of at most 200 rows and
65 KiB, with the exact `offset` and `nextOffset` based on **emitted**
rows (not the nominal page size). It rejects injected expressions, invalid
offsets, active bindings and unsupported object types. No user code is
evaluated to navigate a table. The browser environment viewer can move
between real native R slices; its filtering, sorting and CSV export remain
explicitly **slice-local**, not full-dataset operations. WebR/Python retain
their existing bounded snapshots. The native backend is still Flow 2.0.0;
no new route or hosted CI configuration was introduced.

**Status: partial / independently verified Linux/macOS source, native
Flow/Rscript HTTP and packaging CI; physical-browser navigation and CSV
download still unverified.** [PR #79](https://github.com/godofecht/FlowStudio/pull/79)
merged as [a9d5932](https://github.com/godofecht/FlowStudio/commit/a9d59322a4462ee8c9ade99b3b645c79f0b153f3)
after [CI #40318334700](https://github.com/godofecht/FlowStudio/actions/runs/40318334700)
passed all four jobs on Ubuntu 24.04 and macOS 14, including native
Flow 2.0.0 compilation, real Rscript/HTTP acceptance and packaging.
The opt-in physical-browser acceptance runner now includes real R table
page navigation, 201-251 slice verification, bounded CSV download and
backward navigation, but has not itself been executed independently.
It must be run with a compiled native server, Rscript and browser runtime.
This is not global sorting/filtering, complete dataset export,
authenticated remote execution or RStudio feature parity.

## 2026-10-26: bounded CSV export for tabular previews (verification pending)

The browser CSV/TSV viewer now exports all filtered and sorted preview rows
across pages. The Python/R environment table viewer exports its captured,
bounded table snapshot (at most 200 rows) with the current filter/sort;
it does not fetch unseen kernel rows or claim full dataset export.
RFC-4180 quoting, 8 MiB UTF-8 export limits, shape validation and
spreadsheet-formula escaping apply. Potential formulas gain a leading
apostrophe, so these fields do not round-trip byte-for-byte. No new server
routes, native Flow backend or hosted CI configuration changes.

**Status: partial / independently verified Linux/macOS source, native
Flow/Rscript HTTP and packaging CI; physical-browser download and live
interpreter interaction still unverified.** [PR #78](https://github.com/godofecht/FlowStudio/pull/78)
merged as [0b2d802](https://github.com/godofecht/FlowStudio/commit/0b2d802b258da39c7407744293bee3b4fe073a7b)
after [CI #40310164610](https://github.com/godofecht/FlowStudio/actions/runs/40310164610)
passed all four jobs on Ubuntu 24.04 and macOS 14. Each source job ran
717 JavaScript tests (715 passed, two skipped, zero failures), including
six new CSV-export regressions, and 78 Python tests (11 skipped). Both
native jobs compiled Flow 2.0.0, passed real Rscript and live localhost
HTTP acceptance, and completed platform packaging. Direct V8 serializer
and size-bound checks also passed locally. The actual CSV download buttons
were not independently exercised in a physical browser. This does not
establish full RStudio parity, full unsampled kernel dataset export, live
R function-level debugging or authenticated remote sessions.

## 2026-10-26: Jupyter cell IDs and tags (Linux/macOS CI passed)

The .ipynb importer preserves valid nbformat 4.5 cell IDs and bounded
Jupyter `metadata.tags` in inert percent-cell markers for code and Markdown.
Export restores them, upgrades to 4.5 only when IDs are present, and
assigns deterministic collision-free IDs to cells missing them.
Duplicate IDs and malformed edited markers are rejected. Unsupported
metadata and attachments are omitted with explicit loss notices. The
existing plain 4.4 export is unchanged. Metadata never executes.

**Status: partial / independently verified Linux/macOS source, native Flow
HTTP/Rscript and packaging CI; physical-browser acceptance pending.**
[PR #77](https://github.com/godofecht/FlowStudio/pull/77) merged as
[8b59a8f](https://github.com/godofecht/FlowStudio/commit/8b59a8f94e47381fceb5108a4df0f5ff8c4429af)
after [CI #40302638842](https://github.com/godofecht/FlowStudio/actions/runs/40302638842)
passed all four jobs on Ubuntu 24.04 and macOS 14. Each source job
completed 711 JavaScript tests (709 passed, two skipped, zero failures),
including seven new metadata regressions, and 78 Python tests (11 skipped).
Both native jobs compiled Flow 2.0.0, ran real HTTP/Rscript acceptance and
completed packaging. Seven direct V8 codec checks also passed locally.
Physical-browser import/export was not independently exercised.
This does not restore interpreter state, preserve arbitrary Jupyter metadata,
render knitr documents, provide live R function debugging or establish
RStudio parity. Flow-owned native backend and hosted CI were not changed.

# FlowStudio RStudio parity matrix

## 2026-10-26: supported R Markdown YAML frontmatter roundtrip (Linux/macOS CI passed)

The R Markdown importer retains the strictly accepted scalar `title`,
`author`, `date` and `html_document` YAML header as an inert first Markdown
source cell, rather than discarding it. The exporter recognizes and validates
that first-cell header and reuses it instead of writing a duplicate default
header. Unsupported or malformed edited YAML is rejected; a normal Markdown
thematic break remains ordinary Markdown. No YAML is evaluated by
import/export. The notebook preview may display retained frontmatter as
Markdown text; this is source preservation, not knitr rendering.

**Status: partial / independently verified Linux/macOS source, native Flow
HTTP/Rscript and packaging CI; physical-browser and actual knitr acceptance
pending.** [PR #76](https://github.com/godofecht/FlowStudio/pull/76)
merged as [027bb60](https://github.com/godofecht/FlowStudio/commit/027bb6042fc9da4dcd0b16c90249ce4bd7db2fa0)
after [CI #40298315062](https://github.com/godofecht/FlowStudio/actions/runs/40298315062)
passed all four jobs on Ubuntu 24.04 and macOS 14. Each source job
completed 704 JavaScript tests (702 passed, two skipped, zero failures)
and 78 Python tests (11 skipped). Native jobs compiled real Flow 2.0.0,
passed Rscript/HTTP acceptance and completed platform packaging.
Twenty-nine direct V8 source regression cases also passed locally
(excluding DOM/filesystem wiring). Three new regression cases cover YAML
roundtrip, YAML-only documents and unsupported edited metadata. Existing
roundtrip tests were updated for the retained inert Markdown cell.
The Flow-owned backend, routes and hosted CI configuration did not change.
Full RStudio parity, physical-browser Pyodide/webR acceptance, live R
function debugging and authenticated remote sessions remain outstanding.

## 2026-10-26: named R Markdown code chunks (verification pending)

The .Rmd importer recognizes bounded, case-sensitive chunk labels on R and
Python engines (for example, `{r Setup.1}` and `{python fig-2, eval=TRUE}`).
Labels are preserved in the percent-cell marker as `label=...` metadata, not
in executable code, and restored on R Markdown export. Literal `eval=FALSE`
chunks remain inert Markdown with their original headers. Import and export
reject duplicate labels; import rejects unsupported or expression-valued labels,
and export refuses malformed `label=` source markers. Unnamed cells retain
their existing object shape and behavior. Five Node regression cases cover
roundtrips, disabled chunks, duplicates, invalid labels and compatibility.

**Status: partial / local JavaScript V8 validation only; independent Node,
Linux/macOS native CI and physical-browser acceptance pending.** Fifteen
direct V8 assertions passed against the changed source modules; the three
modules and new test file parsed. This is not actual knitr rendering, live R
function debugging, authenticated remote sessions or RStudio parity. The
Flow 2.0.0 native backend and hosted CI configuration were not changed.
[PR #75](https://github.com/godofecht/FlowStudio/pull/75).

## 2026-10-26: literal knitr eval options on R Markdown import (verification pending)

The existing R Markdown importer now recognizes literal `eval=TRUE` and
`eval=FALSE` on R and Python code chunks. `eval=TRUE` remains an executable
FlowStudio code cell. `eval=FALSE` is imported as an inert Markdown cell
containing the original fenced chunk, so notebook execution cannot run it,
and an R Markdown export retains the disabled knitr option. Arbitrary knitr
options and nonliteral expressions such as `eval=F` remain rejected rather
than silently changing execution semantics. The existing 64 KiB cell,
percent-marker, source and input limits still apply.

**Status: partial / independently verified Linux/macOS source, native
Flow HTTP/Rscript and packaging CI; physical-browser acceptance pending.**
[PR #74](https://github.com/godofecht/FlowStudio/pull/74) merged as
[75fba1d](https://github.com/godofecht/FlowStudio/commit/75fba1dc6b52f23306b57c8f9720e24c8b31dbef)
after [CI #40282340119](https://github.com/godofecht/FlowStudio/actions/runs/40282340119)
completed all four jobs successfully on Ubuntu 24.04 and macOS 14.
Each source/transport job ran 696 JavaScript tests (694 passed, two skipped,
zero failures) and 78 Python tests (11 skipped). Both native jobs compiled
the real pinned Flow 2.0.0 backend, ran native HTTP/Rscript acceptance and
completed packaging. Six new Node regression cases exercise both languages,
round-trip preservation, notebook-runner non-execution, malformed input and
bounds. Local JavaScript-isolate checks additionally passed for real module
import/export roundtrip and notebook execution non-execution. Physical-browser
interaction and actual knitr rendering were not run. No native Flow routes
or hosted CI configuration were changed.
Actual knitr rendering, arbitrary chunk options, live R function debugging,
remote sessions and full RStudio parity remain unimplemented or unverified.


## 2026-10-26: run notebook from caret (Linux/macOS CI passed)

The Pages and native Flow-served /app/ notebook toolbar now provides **Run from here**.
It resolves the current percent-cell from the real textarea caret and executes
only that cell and subsequent code cells through the existing Flow/R/Python
runtimes. Markdown is rendered but never executed. Native Flow preflight,
mixed-language tags, persistent R/Python state, cancellation, per-cell/output
bounds and stop-on-error remain in effect. Preceding cells are not replayed,
so dependencies must already exist in the selected kernel. Results show only
the executed subset, never stale earlier outputs.

**Status: partial / independently verified Linux/macOS source, native
Flow HTTP and packaging CI; physical-browser interpreter acceptance pending.**
[PR #73](https://github.com/godofecht/FlowStudio/pull/73) merged as
[dd07fe5](https://github.com/godofecht/FlowStudio/commit/dd07fe59bfea1b44e57ae704e91775687c82cf71)
after [CI #40276233646](https://github.com/godofecht/FlowStudio/actions/runs/40276233646)
passed all four jobs on Ubuntu 24.04 and macOS 14. Each source/transport
job ran 690 JavaScript tests (688 passed, two skipped, zero failed) and
78 Python tests (11 skipped). Both native jobs compiled Flow 2.0.0, passed
live Flow-owned HTTP/Rscript acceptance and packaged the platform binaries.
Local V8 selected-cell and Flow-preflight assertions passed. Six Node
regressions and opt-in physical-browser scenarios for actual Pyodide and
webR execution were committed, but the physical-browser scenarios have
**not** been independently run. Native Flow routes, compiler and hosted
CI workflow were not modified. This is not function-level R debugging,
remote isolation or RStudio parity.


## 2026-10-26: safe Jupyter saved-output import (cross-platform CI pending)

The existing .ipynb importer now retains **display-only** stdout/stderr,
plain-text execute/display results, traceback text and PNG images in the
FlowStudio notebook output pane. Imported source and saved output are never
executed, and no HTML, SVG, JavaScript, widget MIME or external image URL is
rendered. Unsupported or oversized outputs are omitted with an explicit
loss notice. Per-cell text is capped at 128 KiB, aggregate imported text at
1 MiB, PNGs at 512 KiB, plots at eight per cell, output objects at 64 per
cell, and imported results at 128. UTF-8 truncation preserves code points.
Only already-supported Python/R single-kernel notebooks are imported.
Re-export does not invent Jupyter execution counts.

**Status: partial / independently verified source, native Flow and packaging
CI on Linux/macOS; physical-browser acceptance pending.** [PR #72](https://github.com/godofecht/FlowStudio/pull/72)
merged as [86f121a](https://github.com/godofecht/FlowStudio/commit/86f121a10baa66f068b4fb18f789af1d92939a4c)
after [CI #40273394782](https://github.com/godofecht/FlowStudio/actions/runs/40273394782)
passed all four jobs on Ubuntu 24.04 and macOS 14. Each source/transport job
ran 684 JavaScript tests (682 passed, two skipped, zero failed), including
12 new notebook regressions; native jobs compiled Flow 2.0.0, passed live
HTTP/Rscript acceptance and completed platform packaging. Eleven
actual-source V8 smoke assertions also passed locally. This does not restore interpreter state, preserve
execution counts, reconstruct HTML/widget outputs or provide RStudio parity.
The Flow-owned native backend and hosted CI configuration are unchanged.


## 2026-10-26: bounded R Markdown (.Rmd) import (CI pending)

The browser notebook toolbar can open real .Rmd text files as editable
FlowStudio percent-cell source. A non-executing parser recognizes standard
backtick/tilde `{r}` and `{python}` chunks (including longer fences),
preserves ordinary Markdown and non-executable fenced examples, normalizes
line endings, and selects the first executable chunk's language. Import is
guarded by the existing unsaved-editor confirmation and notebook-busy checks.
The decoder enforces 4 MiB input, 2 MiB editor, 64 KiB per cell and 256-cell
limits, and validates the resulting representation with the actual source-cell
parser. Scalar title/author/date/html_document YAML may be read but is
**explicitly discarded** with a user-facing notice. Unsupported YAML,
knitr chunk options, non-R/Python engines, unterminated executable chunks and
percent-cell markers reject instead of silently changing source semantics.
Inline R in Markdown is retained as inert text and is not executed by
FlowStudio. Nothing is knitted or executed during import.

**Status: partial / 10 of 10 new regression cases exercised in a local V8
isolate; Node, physical-browser, native Flow and Linux/macOS CI acceptance
pending.** This is a deliberately narrow, loss-aware importer, not general
R Markdown or RStudio parity. The Flow-owned static asset allowlist was extended to serve both R Markdown
modules and two previously omitted mixed-language assets; no execution route,
compiler implementation or hosted CI configuration was modified. An initial CI run exposed isolated test harnesses that do not load optional
browser modules; bootstrap now tolerates the absent optional import module.
The following source/transport jobs passed on Linux and macOS, but native
acceptance was not yet established. A newly discovered omission in the
native Flow static asset allowlist is now corrected, with a discoverable
Python regression test that checks all browser assets. Next gates are the
latest Linux/macOS Node/Python and native Flow HTTP/Rscript CI jobs and
physical-browser interpreter checks.

## 2026-10-26: R Markdown (.Rmd) source export (Linux/macOS CI passed)

The browser notebook toolbar now exports genuine R Markdown source with
Markdown, R and Python code chunks from the existing percent-cell parser.
The output has an `html_document` YAML header, Pandoc-compatible variable-
length backtick fences (so embedded fences cannot prematurely close a code
chunk), explicit per-cell runtime engines, and bounded source/cell/output
sizes. Flow-default and Flow-tagged code are rejected rather than silently
presented as executable knitr chunks. Exports never evaluate source, and
captured outputs are intentionally not embedded: knitting is an external
execution step. Python chunks require a configured Python/reticulate engine.

**Status: partial / independently verified source and native Linux/macOS CI;
physical-browser download and actual rmarkdown::render/knitr acceptance
unverified.** [PR #70](https://github.com/godofecht/FlowStudio/pull/70)
merged as [88472da](https://github.com/godofecht/FlowStudio/commit/88472dafd80c0ba594dcc23caa0ab41fca95bda4)
after [CI #40265718458](https://github.com/godofecht/FlowStudio/actions/runs/40265718458)
completed all four jobs successfully on Ubuntu 24.04 and macOS 14.
Each source/transport job ran 662 JavaScript tests (660 passed, two skipped,
zero failures), including seven new R Markdown regressions, and 76 Python
tests (11 skipped). Both native jobs compiled the real Flow 2.0 backend,
passed existing Flow HTTP/Rscript acceptance and completed packaging.
Local V8 acceptance passed 11/11 checks against the committed serializer,
source-cell parser and browser HTML. This is an export-only
interoperability feature, not R Markdown import, RStudio rendering parity,
Flow execution through knitr, or full RStudio compatibility. The native
Flow-owned backend and hosted CI configuration are unchanged.

## 2026-10-26: offline HTML reports for Flow and mixed-language notebooks (verification pending)

The browser Export HTML report path now uses the validated portable .fsnb
codec for Flow-default or mixed Flow/R/Python source, preserving per-cell
runtime labels, escaped code, markdown, captured stdout/stderr, truncation
notices and PNG plots. The original single-kernel Jupyter report path remains
unchanged for homogeneous Python/R notebooks. This is an offline display
artifact; it neither runs Flow in the browser nor asserts Jupyter multi-kernel
execution. Output snapshots are included only when source and default language
match the executed notebook. The existing size and provenance bounds of the
.fsnb decoder and HTML renderer apply.

**Status: partial / independently validated on Linux and macOS CI;
physical-browser interaction unverified.** [PR #69](https://github.com/godofecht/FlowStudio/pull/69)
passed all four jobs in [CI #40261214733](https://github.com/godofecht/FlowStudio/actions/runs/40261214733)
on Ubuntu 24.04 and macOS 14, including the new six-case regression suite,
the existing source/transport tests, real native Flow compilation, HTTP
acceptance and platform packaging. Local JavaScript-isolate smoke checks also
passed. The Flow-owned native backend and hosted CI configuration are
unchanged. This does not establish RStudio parity. Function-level live R
debugging, authenticated remote sessions and physical-browser Pyodide/webR/
native Flow acceptance remain outstanding.


## 2026-10-26: F2 previewed lexical identifier rename (Linux/macOS CI passed)

The Flow-served native editor now offers Edit > Rename identifier and F2.
The user selects a Flow, R or Python identifier, supplies a valid non-keyword
replacement, explicitly previews affected occurrences and applies the change
to the active buffer or, opt-in, other already-open tabs of the same language.
Changes update the real open-document model and dirty indicators; **nothing
is written to disk until the user saves**. A 24-document/200-reference/2-MiB
bound, collision rejection, comment/string/member exclusion, and full-buffer
snapshot checks prevent silent truncation or overwriting edits made after
preview. All buffers are validated before the transactional in-memory update.
The scanner also excludes spaced Python member and R member/namespace access.
No hosted CI, Flow compiler, or Flow-owned backend routes changed.

**Status: partial / independently verified Linux/macOS source, native and
packaging CI; physical-browser interaction unverified.**
[PR #68](https://github.com/godofecht/FlowStudio/pull/68) merged as
[28ec02d](https://github.com/godofecht/FlowStudio/commit/28ec02dd91d3bd62afcda732912da312a586c2c0)
after [CI #40255793082](https://github.com/godofecht/FlowStudio/actions/runs/40255793082)
completed all four jobs successfully on Ubuntu 24.04 and macOS 14.
Each source/transport job ran 649 JavaScript tests (647 passed, two skipped,
zero failures), including ten new rename regressions, and 76 Python tests
(11 skipped). Both native jobs pinned Flow 2.0.0, compiled the real backend,
passed native Rscript/Flow HTTP acceptance and completed packaging. Local
V8 execution of the ten new regression cases passed; all six inline editor
scripts parsed. Physical-browser F2 interaction was not independently run.

This is deliberately **lexical** rename, not semantic refactoring: shadowed
bindings, imports, dynamic R names, Python f-string expressions and unopened
files are not resolved. It does not establish RStudio feature parity.
Live function-level R breakpoints, authenticated remote sessions and real
physical-browser interpreter acceptance remain outstanding.

## 2026-10-26: native editor Shift+F12 lexical references (Linux/macOS CI passed)

The Flow-served native editor now offers Edit > Find references and Shift+F12.
A bounded single-pass scanner finds exact Flow, R and Python identifier tokens
in already-open buffers, skips comments and quoted strings (including Python
triple strings), excludes member-field tokens, and displays navigable file,
line and column results. It searches at most 24 open documents and returns at
most 200 results with an explicit truncation marker. Results are rendered as
inert text and never execute code or read unopened files. Unsaved edits in the
active buffer are included. This is **lexical occurrence search**, not semantic
binding resolution: shadowing, imports, dynamic R bindings, f-string expressions
and unopened project files are not resolved. No native Flow HTTP route or CI
configuration changed. Added six Node regression tests and V8 lexical checks.
**Status: partial / independently verified Linux/macOS source, native and
packaging CI; physical-browser interaction unverified.** [PR #67](https://github.com/godofecht/FlowStudio/pull/67)
merged as [28f22bf](https://github.com/godofecht/FlowStudio/commit/28f22bf110f18178c354bc21e08677e4a2fe9a81)
after [CI #40251541713](https://github.com/godofecht/FlowStudio/actions/runs/40251541713)
completed all four jobs successfully on Ubuntu 24.04 and macOS 14.
Each source/transport job ran 639 JavaScript tests (637 passed, 2 skipped,
0 failed), including the six new reference regressions, and 76 Python tests
(11 skipped). Both native jobs compiled Flow 2.0.0, passed real Rscript IPC
and live Flow-owned HTTP acceptance, and completed platform packaging.
Physical-browser Shift+F12 interaction and Pyodide/webR acceptance were not
executed. Function-level R breakpoints, authenticated remote sessions and
complete RStudio parity remain outstanding. No hosted CI configuration changed.

## 2026-10-25: native editor F12 go-to-definition (Linux/macOS CI passed)

The Flow-served native editor now resolves a source identifier at the caret
to an actual declaration in the active Flow, R or Python buffer. If the active
buffer has no matching declaration, it searches only already-open tabs of the
same language and switches tabs **only when exactly one definition exists**.
Ambiguous cross-tab matches are refused. F12 and Edit > Go to definition
navigate to the declaration's line and column; no source is executed, no
filesystem permission is requested, and no server route or hosted CI workflow
changes. Lexical checks reject identifiers in comments, quoted text and Python
triple-quoted strings. The existing bounded outline scanner supplies the
declarations. This is a best-effort source-local lookup, **not** a language
server: imports, dynamic bindings, member resolution, local variables and
unopened project files are not resolved.

Added automated Node regression cases for Flow/R/Python, comment/string
exclusion, nearest preceding definitions, unique/ambiguous open tabs and F12
wiring. The new source resolver and all six inline editor scripts passed direct
local V8 validation. **Status: partial / independently verified Linux/macOS
source, native and packaging CI; physical-browser interaction unverified.**
[PR #66](https://github.com/godofecht/FlowStudio/pull/66) merged as
[c2bbafa](https://github.com/godofecht/FlowStudio/commit/c2bbafa9c6ed95defb379cfbfc901b2c7875355f)
after [CI #40246806828](https://github.com/godofecht/FlowStudio/actions/runs/40246806828)
completed all four jobs successfully on Ubuntu 24.04 and macOS 14.
Each source/transport job ran 633 JavaScript tests (631 passed, two skipped,
zero failed), including seven new F12 regressions, and 76 Python unit tests
(11 skipped). Both native jobs compiled Flow 2.0.0, passed live Flow-owned
HTTP/Rscript acceptance and completed platform packaging. No hosted CI
configuration was changed. This is not semantic LSP navigation or RStudio
parity; live function-level R debugging, authenticated remote sessions and
physical-browser interpreter acceptance remain missing.


## 2026-10-25: retained R postmortem user-function frames (implementation; validation pending)

The persistent native Rscript kernel now captures up to eight **actual lexical
user-function environments** when an error is signalled, before the R stack
unwinds. The debugger's JSON status includes bounded call labels and up to
16 local binding **names** per frame without reading or forcing their values.
Frame 0 continues to mean the top-level persistent workspace. In the native
browser debugger, selecting frame 1–8 explicitly evaluates a single real R
expression in the retained function environment via the existing Flow-owned,
origin/intent-gated `/api/debug/r/evaluate` endpoint. The protocol prefix
`@N\n` is consumed by R before parsing the requested expression. Evaluation
may mutate the retained environment and perform I/O; it is **not sandboxed**.
No code is resumed after the failed call unwinds. Stop/Start discard retained
frames; normal execution and paused evaluations do not expose function frames.

Native C/R IPC tests and Flow HTTP acceptance exercise nested user closures,
actual local bindings, evaluation and cleanup; browser tests cover frame
selection and bounded response validation. **Status: partial / independently verified native Linux/macOS CI;
physical-browser acceptance pending.** [PR #65](https://github.com/godofecht/FlowStudio/pull/65)
merged as [a2e6a5d](https://github.com/godofecht/FlowStudio/commit/a2e6a5dc58bffcebbde273e683e204b035b1099a)
after [CI #40242509771](https://github.com/godofecht/FlowStudio/actions/runs/40242509771)
passed all four jobs on Ubuntu 24.04 and macOS 14. Each source/transport
job passed 624 of 626 JavaScript tests (2 skipped, 0 failed), plus 76 Python
tests. Both native jobs compiled Flow 2.0.0, passed real Rscript/C IPC
nested-function-frame acceptance and live Flow HTTP acceptance, and completed
platform packaging. The physical-browser scenario was not executed.
This is postmortem function-frame evaluation, **not live function breakpoints,
step-into/over, or resumable stack frames**. Authenticated remote sessions,
physical-browser Pyodide/webR/Rscript acceptance and full RStudio parity remain
outstanding. No hosted CI configuration changed.

## 2026-10-25: native R postmortem top-level workspace evaluation (Linux/macOS CI passed)

The real persistent Rscript debugger now retains the failed **top-level** source
line in `failed_line` after Step or Continue raises an R error. Status requests
retain that location until Stop or a new Start. The existing Flow-owned,
origin/intent-gated `POST /api/debug/r/evaluate` route now permits an explicit
one-expression evaluation in the failed session, preserving the error state and
source location even when the postmortem evaluation itself fails. The browser
panel displays the failed line and enables Evaluate without enabling Step or
Continue after failure. The client validates the optional positive failure line.
Postmortem expressions are **real R code with local-user privileges** and can
mutate the persistent top-level workspace; no sandbox or read-only guarantee is
claimed. No failed expression is automatically retried or resumed, and the
remaining source is not executed. **Unwound function frames are not retained**;
this is not RStudio's interactive function-frame debugger.

Real R/C IPC regression assertions cover the failed line, persistent status,
successful and failing postmortem evaluation, refusal to Step after failure,
workspace persistence, and Stop. Browser tests cover the enabled controls,
rendered failure location and rejection of malformed failure metadata.
**Status: partial / independently verified native Linux/macOS CI;
physical-browser acceptance pending.** [CI #40236961936](https://github.com/godofecht/FlowStudio/actions/runs/40236961936)
passed all four jobs on Ubuntu 24.04 and macOS 14. Each source/transport job
ran 624 JavaScript tests (622 passed, 2 skipped, 0 failed) and 76 Python tests
(11 skipped). Both native jobs compiled Flow 2.0.0, passed real Rscript IPC
postmortem regression tests and live Flow HTTP acceptance, and packaged the
platform builds. Local Flow and Rscript executables are unavailable; physical-
browser acceptance was not executed. Flow remains the native HTTP backend,
and no hosted CI configuration changed. Function breakpoints, step-into/over,
stack-frame inspection, authenticated remote sessions and RStudio parity
remain missing.

## 2026-10-25: conditional native R top-level breakpoints (implementation; independent acceptance pending)

The existing Flow-owned, origin/intent-gated `POST /api/debug/r/continue`
endpoint accepts up to 64 future top-level source lines with optional numeric
conditions, such as `2?counter>=3,4?counter==5`. The persistent real Rscript
kernel evaluates conditions at the next matching top-level expression boundary,
using only classless finite integer/double scalar bindings in its own workspace.
It does **not** eval arbitrary breakpoint expressions, invoke active bindings,
or dispatch overloaded comparison methods. Missing, nonnumeric and nonfinite
values do not trigger a conditional stop. Lazy R promises may be forced by
inspection, so breakpoint conditions are **not** guaranteed side-effect free.
Malformed syntax and nonexistent future target lines reject before any source
executes; false conditions allow execution to continue normally. Blank Continue
still runs to completion. No new backend, network route or hosted CI change.

Real Rscript/C IPC and live Flow HTTP acceptance cases, browser controller
tests and an opt-in physical-browser scenario are committed. **Status: partial / independently verified native Linux/macOS CI;
physical-browser acceptance still pending.** [PR #63](https://github.com/godofecht/FlowStudio/pull/63)
merged as [db16944](https://github.com/godofecht/FlowStudio/commit/db16944005276c440e568964af2d45f49b1491e0)
after [CI #40232365726](https://github.com/godofecht/FlowStudio/actions/runs/40232365726)
completed all four jobs successfully. Ubuntu 24.04 and macOS 14 each
ran 623 JavaScript tests (621 passed, 2 skipped, 0 failed) and 76 Python
unit tests (11 skipped). Native jobs compiled Flow 2.0.0, exercised real
Rscript IPC and Flow-owned localhost HTTP conditional-breakpoint acceptance,
and packaged both platforms. Local V8 client/controller exercises passed.
The opt-in physical-browser scenario was committed but has **not** been run.
No hosted CI configuration changed. This does not implement breakpoints inside
function bodies, step-into/over, stack-frame inspection, authenticated remote
sessions or complete RStudio parity.

## 2026-10-25: interactive evaluation at a paused native R expression (Linux/macOS CI passed)

The native R debugger now exposes Flow-owned, origin/intent-gated
`POST /api/debug/r/evaluate`. A dedicated C IPC opcode evaluates exactly
one parsed R expression in the **real persistent R workspace** while the
top-level expression debugger is paused. The pending source position does
not advance, even if evaluation fails. Invalid syntax, multiple expressions,
empty input, inputs above 4096 UTF-8 bytes, and evaluation without a paused
session are rejected. The browser IDE exposes an explicit Evaluate control;
R output and errors are returned as bounded debugger JSON. This is actual
R execution, **not** a read-only watch, simulation, sandbox, or stack-frame
evaluator: expressions may mutate variables, call functions, or perform I/O
with the local user's permissions.

Native R IPC, live Flow HTTP and browser-controller regressions are included,
along with an opt-in physical-browser scenario. **Status: partial /
independently verified native Linux/macOS CI; physical-browser acceptance
pending.** [PR #62](https://github.com/godofecht/FlowStudio/pull/62)
merged as [3749d5f](https://github.com/godofecht/FlowStudio/commit/3749d5f2d27ca2912b5cdb51b68636ef3e2a62d5)
after [CI #40228176825](https://github.com/godofecht/FlowStudio/actions/runs/40228176825)
completed all four jobs successfully. Ubuntu 24.04 and macOS 14 each passed
621 JavaScript tests (2 skipped, 0 failed) and 76 Python unit tests
(11 skipped). Both native jobs compiled Flow 2.0.0, passed real Rscript IPC
evaluation and live Flow HTTP acceptance, and packaged the platform builds.
An initial CI attempt failed a stale opcode contract expectation; it was
corrected and independently rerun successfully. The physical-browser
scenario was committed but not independently executed.
No hosted CI configuration changed. Function breakpoints, step-into/over,
stack-frame inspection, authenticated remote sessions and full RStudio
parity remain unimplemented.


## 2026-10-25: multiple top-level R debugger breakpoints (Linux/macOS CI passed)

The existing Flow-owned `POST /api/debug/r/continue` endpoint now accepts up to
64 comma-separated positive source lines (each at most six digits). The
persistent native Rscript kernel parses the list strictly as data and stops
before the earliest **future** matching top-level parsed expression, regardless
of input order. The same list can be reused to continue to the next match.
Malformed input, missing future targets and overlong lists reject without
executing an expression. A blank target continues to completion. The browser
debugger accepts the list and displays its source position. No new route,
alternate backend or hosted CI change is required.

**Status: partial / independently verified native Linux/macOS CI;
physical-browser acceptance pending.** [PR #61](https://github.com/godofecht/FlowStudio/pull/61)
merged as [7fd3447](https://github.com/godofecht/FlowStudio/commit/7fd34471ae32e1715e48cfc94d279a689419a221)
after [CI #40223358826](https://github.com/godofecht/FlowStudio/actions/runs/40223358826)
completed all four jobs successfully on Ubuntu 24.04 and macOS 14.
Source/transport jobs, native Flow 2.0.0 compilation, real Rscript IPC
regressions, Flow-owned HTTP acceptance and platform packaging passed.
A direct V8 controller exercise also verified multi-target forwarding and
invalid-list rejection. Physical-browser acceptance was not run. This feature only
stops between top-level expressions: breakpoints inside functions, step-into,
stack-frame evaluation, authenticated remote sessions and full RStudio parity
remain unimplemented.


## 2026-10-25: native R top-level continue and run-to-line (Linux/macOS CI passed)

FlowStudio's Flow-owned `POST /api/debug/r/continue` route sends a distinct
native C opcode F to the persistent Rscript interpreter. Continue executes
actual parsed top-level R expressions in the existing workspace, stopping
before an optional future top-level source line, at completion, or on the
first real execution error. Invalid, missing and already-passed targets reject
without running code. The browser exposes Continue and an optional target
line; execution output and source positions remain bounded.

**Status: partial / independently verified native Linux/macOS acceptance;
physical-browser acceptance pending.** [PR #60](https://github.com/godofecht/FlowStudio/pull/60)
merged as [1dd009f](https://github.com/godofecht/FlowStudio/commit/1dd009f3f863393f9fd843ee6d6d2c26f19cfb20)
after [CI #40218879597](https://github.com/godofecht/FlowStudio/actions/runs/40218879597)
completed all four jobs successfully on Ubuntu 24.04 and macOS 14.
Each source/transport job passed 621 JavaScript tests (2 skipped, 0 failed),
76 Python unit tests (11 skipped), plus additional transport checks.
Native jobs compiled Flow 2.0.0, exercised real Rscript IPC continuation
and live Flow-owned HTTP acceptance, and packaged both platforms.
The first CI attempt caught an outdated opcode-regex fixture, corrected
before the successful run. The optional physical-browser scenario has been
committed but **not independently executed**. This does not provide function
breakpoints, step-into/over, stack-frame evaluation, authenticated remote
sessions or full RStudio parity. No hosted CI configuration changed.


## 2026-10-25: native R top-level expression stepping (implementation; acceptance pending)

FlowStudio's Flow-owned localhost server now exposes intent/origin-gated
`POST /api/debug/r/{start,step,stop,status}` operations. The existing C
length-framed IPC sends distinct operations to the persistent Rscript kernel.
Starting parses actual R source with source references but **does not execute**.
Each Step evaluates exactly one original parsed top-level expression in the
existing R workspace, preserving ordinary stdout, warnings, error handling
and plot capture. The browser's R expression debugger panel displays next
source line, completed expression and bounded output. While paused, ordinary
R evaluation and package mutations are refused; status and read-only
inspection remain available. Syntax errors and execution failures do not
silently advance through remaining source.

**Status: partial / independently verified native Linux/macOS CI; physical
browser acceptance pending.** Real Rscript IPC assertions cover source lines,
three-expression stepping, workspace persistence, mutation exclusion, parse
errors, failure handling and stop. Live Flow HTTP acceptance covers actual
Rscript stepping and origin/intent rejection. Browser unit tests cover controls,
client validation and static route wiring; the optional physical-browser
runner now exercises real DOM-to-Rscript stepping. [PR #59](https://github.com/godofecht/FlowStudio/pull/59) merged as
[7d25034](https://github.com/godofecht/FlowStudio/commit/7d25034e2f1573c3dd8e64e2f85221d962e3a704)
after [CI #40213901345](https://github.com/godofecht/FlowStudio/actions/runs/40213901345)
completed all four jobs successfully. Ubuntu 24.04 and macOS 14 each passed
621 JavaScript tests (2 skips, zero failures), 76 Python unit tests, real
Rscript IPC stepping, live Flow-owned HTTP acceptance and native packaging.
A first CI attempt exposed an outdated IPC opcode fixture; a second exposed
the Flow 2.0 requirement for `elif` rather than `else if`. Both were fixed
before the independently passing run. Local Rscript and Flow compilers remain
unavailable in the authoring environment; real physical-browser acceptance
has not been executed. This is **not** function breakpoints,
step-into/over, stack-frame evaluation or full RStudio debugging; an entire
function call inside one top-level expression executes without interruption.
Authenticated remote sessions and complete RStudio parity remain missing.
No hosted CI configuration was changed.


## 2026-10-25: bounded native R runtime call-stack diagnostics (Linux/macOS CI passed)

The persistent Rscript interpreter now captures a bounded deparsed call chain
**at the point an uncaught error is signalled**, before R's exiting error
handler unwinds the user frames. The existing Flow-owned `/api/run/r` route
returns the actual error plus up to 16 syntax-only call frames (180 characters
per frame), without evaluating or printing user objects. A real R/C IPC
regression asserts nested `outer()` / `inner()` frames and verifies that the
same interpreter continues executing after the error. No new network route,
hosted CI change or Flow compiler syntax is introduced.

**Status: partial / independently verified native Linux/macOS CI; physical
browser acceptance pending.** [PR #58](https://github.com/godofecht/FlowStudio/pull/58)
merged as [72bbcc7](https://github.com/godofecht/FlowStudio/commit/72bbcc7ac28e5d077240fd6c50ff4a56b5919e12)
after [CI #40208720442](https://github.com/godofecht/FlowStudio/actions/runs/40208720442)
completed all four jobs successfully on Ubuntu 24.04 and macOS 14.
The source/transport jobs and native Flow compilation, real Rscript IPC
regression, live HTTP acceptance and packaging passed on both platforms.
This is error traceback information, **not interactive R breakpoints,
single-stepping or stack-frame evaluation**. Physical-browser execution,
authenticated remote sessions and RStudio feature parity remain outstanding.

## 2026-10-25: one-level conflict-checked project replacement undo (Linux/macOS CI passed)

Native and Pages editors now offer an explicit one-level undo after a fully
successful project-wide replacement. The reverse operation uses actual
File System Access writes with full preflight checks against disk snapshots
and open editor tabs. External edits are never overwritten. Switching projects,
another replacement, or an attempted undo invalidates history. Undo is
in-memory only; multi-file writes remain non-atomic, and partial failures may
require manual recovery. No source files are uploaded to the Flow backend.

**Status: partial / independently verified Linux/macOS CI; physical-browser
acceptance pending.** [PR #57](https://github.com/godofecht/FlowStudio/pull/57)
merged as [385e7bf](https://github.com/godofecht/FlowStudio/commit/385e7bf82de8b70c6817f4e737e7c283c6ad7d3d)
after [CI #40204492656](https://github.com/godofecht/FlowStudio/actions/runs/40204492656)
completed all four jobs successfully on Ubuntu 24.04 and macOS 14. Each
source/transport job passed 618 JavaScript tests (2 skips, zero failures),
76 Python unit tests (11 skips), plus the C transport and Python harness
suites. Both native jobs built the real Flow 2.0.0 backend, passed live HTTP
acceptance and completed packaging. Local V8 checks also executed the real
project replacement/undo controller and Pages panel against writable file
handles. Real physical-browser file-picker acceptance was **not** executed.
No hosted CI configuration or Flow compiler syntax changed. This improves
editor safety without establishing RStudio parity; native R/Flow interactive
debugging and authenticated remote sessions remain missing.



## 2026-10-25: Pages project-wide replacement controls (Linux/macOS CI passed)

The Pages/browser workspace now exposes a real project-wide replacement panel
backed by the existing browser-granted File System Access project engine.
Literal, regex, Unicode whole-word and case-sensitive options produce a
read-only preview with per-file counts and before/after excerpts. Explicit
confirmation is required before applying. Changes to search controls invalidate
the preview; project switches, stale disk contents and files held by the
source editor are refused before writes. Open-editor detection awaits actual
`FileSystemHandle.isSameEntry` when file handles differ. Native and Pages
replacement engines both await asynchronous blocked-file guards.

The existing bounds remain in force (200 search matches, 50 changed files,
8-million-character preview budget, regex files limited to 128 KiB).
Multi-file writes are **not atomic**; failures after some files were written
are reported as partial changes, never as rollback. Project sources are not
uploaded to the Flow backend.

**Status: partial / independently verified Linux/macOS CI; physical-browser
acceptance still pending.** [PR #56](https://github.com/godofecht/FlowStudio/pull/56)
merged as [41d8315](https://github.com/godofecht/FlowStudio/commit/41d83150ac3e2f875d0b19ad2981f1a1872d9db0)
after [CI #40199211176](https://github.com/godofecht/FlowStudio/actions/runs/40199211176)
completed all four jobs successfully on Ubuntu 24.04 and macOS 14.
Each source/transport job passed 604 JavaScript tests (602 passing,
2 skipped, zero failures), alongside 76 Python unit tests.
Both native jobs compiled Flow 2.0.0, passed real Flow-owned HTTP acceptance
and packaged the platform builds. Earlier CI exposed missing optional-module
guards in browser VM fixtures and a stale native embedded project engine;
both were fixed before the successful run. The physical-browser
file-picker scenario and real Pyodide/webR/native R acceptance were not run
in this CI workflow.
No hosted CI configuration or Flow compiler syntax was changed. This
improves the Pages project UI but does not establish RStudio parity;
physical-browser interpreter acceptance, interactive R/Flow debugging,
authenticated remote sessions and full desktop compatibility remain open.



## 2026-10-25: project-wide literal/regex replacement (implementation; cross-platform CI pending)

The native four-pane IDE now previews project-wide literal or Unicode whole-word
regex replacements, including numbered and named capture groups, over actual
browser-granted local source files. A separate, explicit confirmation is required
before any writes. The project API uses the same tested editor replacement
engine as in-buffer replacement and never sends project source to the Flow
server. The Flow-owned localhost execution backend remains unchanged.

A preview is refused if the project search was truncated or skipped large files,
if a match moved before preview, if more than 50 files would change, or if the
8-million-character combined before/after preview budget is exceeded. Search
itself remains limited to 200 matches and to 128 KiB files for regex or 1 MiB
files for literal matching. Before writing, the implementation verifies every
target file still matches its preview and rejects any target open in an editor
tab (including clean tabs), avoiding stale editor buffers and accidental
overwrites of unsaved work. Each file is rechecked before its write and the
written content is verified. A later permission or filesystem failure may leave
earlier files changed: **multi-file writes are not atomic** and no rollback is
claimed. The Pages project API exposes the same preview/apply methods, but the
Pages UI does not yet expose project-wide replacement controls.

**Status: partial / independently accepted by Linux/macOS CI; physical-browser
acceptance pending.** [PR #55](https://github.com/godofecht/FlowStudio/pull/55)
merged as [1aae67c](https://github.com/godofecht/FlowStudio/commit/1aae67ce7d3a25b8b717bbbd7912beecf5cf5dc0)
after [CI #40195397710](https://github.com/godofecht/FlowStudio/actions/runs/40195397710)
passed all four jobs on Ubuntu 24.04 and macOS 14. Each source/transport
job passed 594 JavaScript tests (2 skipped, zero failures), including native
editor VM integration and 18 native/Pages replacement API tests; Python
unittest completed 76 tests (11 skipped). Both native jobs compiled the real
Flow 2.0.0 server, passed live Flow-owned HTTP acceptance and packaged the
platform builds. Physical-browser file-picker replacement and real Pyodide/
webR interpreter acceptance remain unverified. No hosted CI configuration
or Flow compiler syntax changed. R/Flow interactive debugging, authenticated
remote sessions and RStudio feature parity remain incomplete.


## 2026-10-25: project-wide regex and Unicode whole-word search (cross-platform CI passed)

The native four-pane project search now supports explicit Regex and Word
options in addition to case-sensitive literal matching. It scans actual
browser-granted local project files recursively without server upload, returns
real file handles and line/column offsets, and refuses to select stale changed
matches. The Pages project-search module uses the same matching behavior,
although the Pages workspace does not yet expose a project-search UI.
Native and Pages implementations retain limits of 12 directory levels,
500 entries per directory, 1000 files, and 200 matches; regex additionally
skips files above 128 KiB. The file-size bound does not guarantee a time
bound for pathological JavaScript regular expressions.

**Status: partial / independently verified Linux/macOS CI; physical-browser
acceptance pending.** [PR #54](https://github.com/godofecht/FlowStudio/pull/54)
merged as [5e4aa39](https://github.com/godofecht/FlowStudio/commit/5e4aa396fac3c051ca1a349c31b138ab094660e2)
after [CI #40190601719](https://github.com/godofecht/FlowStudio/actions/runs/40190601719)
passed all four jobs on Ubuntu 24.04 and macOS 14. Each source/transport
job recorded 575 JavaScript tests (573 passing, 2 skipped, zero failures)
and 76 Python unit tests (11 skipped). Both native jobs compiled the real
Flow 2.0.0 server, completed live HTTP acceptance and packaged the build.
The new tests cover both standalone modules and native inline search wiring;
a native-editor integration regression also verifies actual result selection
and rejection of disk changes when an editor tab is cached. The initial CI
run caught missing DOM fixture controls; the next run caught stale on-disk
navigation. Both defects were fixed before the successful CI run.
Physical-browser acceptance has not been executed independently. No Flow
compiler syntax, Flow-owned backend or hosted CI configuration changed.
Native R/Flow debugging, authenticated remote sessions and full RStudio
parity remain outstanding.


## 2026-10-25: regex and Unicode whole-word source find/replace (PR acceptance pending)

The browser Flow/R/Python editor and native four-pane editor now expose
opt-in regular-expression and Unicode-aware whole-word search, retaining
literal search as the default. Regex replacement expands numbered and named
capture groups, `# FlowStudio RStudio parity matrix
` and `$`; replacement is atomic on malformed patterns,
overlong output or more than 10,000 matches. Regex mode is restricted to
128 KiB source buffers; literal mode retains the 2 MiB source limit. The
native HTML-embedded engine mirrors the browser module exactly, including
multiline anchors. Regex is evaluated locally by the browser JavaScript
engine; the input limit is not a guarantee against expensive patterns.

**Status: partial / independently verified native Linux/macOS acceptance.**
[CI #40186276335](https://github.com/godofecht/FlowStudio/actions/runs/40186276335)
completed all four jobs successfully on Ubuntu 24.04 and macOS 14.
Each source/transport job passed 561 JavaScript tests (two skipped, zero
failures), 76 Python unit tests (11 skipped), plus the real C transport
suites. Both native jobs compiled Flow 2.0.0, passed Flow-owned HTTP
acceptance and completed packaging. [PR #53](https://github.com/godofecht/FlowStudio/pull/53)
merged as [c4eea38](https://github.com/godofecht/FlowStudio/commit/c4eea38788b0e2488f507d9cb62f2bb6ca2354f9).
V8-isolate execution of the editor-specific committed source and test callbacks
also passed 23/23 checks during authoring. This is not a real
physical-browser pass. The optional physical-browser runner now exercises
actual textarea selections, capture replacement, whole-word matching and
invalid-pattern feedback; that scenario has not been independently run.
The Flow-owned execution backend and hosted CI configuration are unchanged.


## 2026-10-25: native R user-library package updates (implementation; acceptance pending)

Flow now owns the origin/intent-gated `POST /api/packages/r/update` route,
forwarded through bounded C IPC to the persistent Rscript kernel. An explicit,
confirmed browser action checks the configured CRAN index and only installs a
newer version of a package already present in FlowStudio's user library. System
packages, missing user packages, malformed names and loaded namespaces
are rejected. Successful updates verify the installed version after R's actual
`install.packages()`; no arbitrary source, repository or URL is accepted from
HTTP. Updating third-party packages runs code as the local user and cannot
promise automatic rollback after an interrupted installation.

Real Rscript acceptance builds two versions of an offline CRAN fixture,
installs v0.0.1, publishes v0.0.2 in the repository index, updates the installed
package, verifies changed executable behavior and checks up-to-date/no-downgrade
behavior. Native Flow HTTP origin/intent rejection, Node transport/UI validation
and an optional physical-browser negative scenario are included.

**Status: partial / independently verified native Linux/macOS acceptance.**
[CI #40182126305](https://github.com/godofecht/FlowStudio/actions/runs/40182126305)
completed all four jobs successfully on Ubuntu 24.04 and macOS 14. Each
source/transport platform recorded 553 passing JavaScript tests, two skips and
zero failures, plus 76 Python unit tests. Both native jobs compiled Flow 2.0.0,
executed the real offline v0.0.1-to-v0.0.2 Rscript package upgrade and
up-to-date/loaded-package protections, passed live Flow-owned HTTP acceptance,
and completed packaging. [PR #52](https://github.com/godofecht/FlowStudio/pull/52)
merged as [01f670e](https://github.com/godofecht/FlowStudio/commit/01f670efad91b6b42e16797dc91bed7abf72791f).
Public CRAN downloads, physical-browser acceptance, dependency-conflict
handling, recovery after failed installation, R/Flow interactive debugging and
remote sessions remain unverified or missing. No hosted CI configuration changed.

**Baseline:** RStudio Desktop + Server core scientific IDE workflows. This is a goal and acceptance test list, not a claim of equivalence.

Legend: **unverified** = implementation exists but has not been built/executed in a validated environment; **partial** = explicitly narrower than baseline; **missing** = no implementation. A feature becomes **verified** only with repeatable end-to-end tests on macOS arm64 and Linux x86-64.

## 2026-10-25: native R package removal (cross-platform native acceptance passed)

The native R package panel offers an explicit, confirmed removal action for
packages installed in FlowStudio's dedicated user library. The persistent
Rscript kernel rejects invalid names, system/site-library packages and loaded
namespaces; it verifies removal from the user library. Flow owns the
origin/intent-gated localhost HTTP route, and the browser serializes requests
with session reset. Real Rscript IPC tests install an offline CRAN-style source
fixture, reject removal while its namespace is loaded, reset the kernel, remove
the installed fixture and verify its absence. Live Flow HTTP tests reject
cross-origin/no-intent requests and system-package removal.

[CI #40178422509](https://github.com/godofecht/FlowStudio/actions/runs/40178422509)
passed all four jobs on Ubuntu 24.04 and macOS 14: 549 passing JavaScript
tests, two skips and zero failures per source/transport platform, plus 76
Python unit tests (11 skipped). Both native jobs compiled Flow 2.0.0, passed
real Rscript package-removal acceptance and Flow-owned HTTP acceptance, and
completed packaging. [PR #51](https://github.com/godofecht/FlowStudio/pull/51)
merged as [3fe11f7](https://github.com/godofecht/FlowStudio/commit/3fe11f753e107a1c785b7ec634a90c6b5ec0ae51).
**Status: partial / native Linux/macOS acceptance passed; physical-browser
acceptance remains unverified.** Public CRAN downloads, native package updates,
authenticated remote sessions and R/Flow debugging remain outstanding. No
hosted CI configuration changed.

## 2026-10-25: attach installed packages in persistent native R (acceptance pending)

An explicit `Load installed R package` action is wired through the Flow-owned
localhost `POST /api/packages/r/load` route, the bounded native C IPC
transport and the real persistent Rscript interpreter. The operation calls
R's actual `library()` for a validated package name, attaches the package
to the current native search path, and returns real missing-package errors.
Native and webR package workspaces remain independent. The browser retains
webR's existing installation operation; native installation and updates are
still **not implemented**. Loading a package executes its startup code with
the local user's privileges and is not a sandbox.

Real Rscript IPC and native Flow/HTTP acceptance assertions, browser request
validation, reset serialization, package-panel behavior and origin/intent
rejection tests passed cross-platform CI
[#40170771561](https://github.com/godofecht/FlowStudio/actions/runs/40170771561)
on Ubuntu 24.04 and macOS 14. Each source/transport platform recorded 543
passing JavaScript tests, two skips and zero failures, plus 76 Python unit
tests (11 skipped). Native Flow 2.0.0 compiled and real Rscript package loading
through Flow-owned localhost HTTP passed on both platforms. [PR #49](https://github.com/godofecht/FlowStudio/pull/49)
merged as [e43ebbdf](https://github.com/godofecht/FlowStudio/commit/e43ebbdf1af0ef7a01af42b50b29dfbab56bc8b2).
**Status: partial / native cross-platform acceptance passed; physical-browser
acceptance remains unverified.** This is not RStudio parity.
No hosted CI configuration was changed.

| Feature | 2026-10-15 state | Minimum acceptance criterion |
| --- | --- | --- |
| Four-pane IDE shell | unverified | Source, environment, console and plots render; keyboard/accessibility checks |
| File open / save | partial / conflict-aware browser saves and Save As picker wired; physical browser and native unverified | Native file-picker and download fallback round-trip UTF-8 |
| Flow source execution | partial / native Flow subprocess route integrated into browser IDE at /app/; physical-browser acceptance pending | Compile and run valid code; surface diagnostics for invalid code |
| R source execution | partial / browser webR 0.6.0 integrated, Node-mock tested; opt-in native Rscript editor execution through the Flow-owned persistent HTTP kernel cross-platform CI accepted (#40159464872; physical-browser acceptance pending) | Run via installed R; preserve state across evaluations |
| Python source execution | partial / native persistent CPython kernel added; local C IPC and Flow-owned HTTP tested in Linux/macOS CI; physical-browser acceptance pending | Run via installed Python; preserve state across evaluations |
| Editor selection execution | partial / Node-tested browser selection; native and physical-browser unverified | Selection runs without accidentally executing entire buffer |
| Persistent REPL/session | partial / browser Pyodide/webR sessions; native Python process retention and reset added (local C harness and cross-platform Flow HTTP CI passed); native R persistent kernel passed real Rscript and Flow-owned HTTP acceptance on Linux/macOS CI | Incremental variables and package state persist until reset |
| Interactive multi-language console | partial / Python and R browser sessions, opt-in native Rscript console routing (cross-platform Node/Flow HTTP CI accepted; physical-browser pending), plus stateless native Flow full-program execution wired; per-language histories and unsent drafts implemented; 427/427 JS tests per platform and native Flow/HTTP CI passed on Ubuntu/macOS; live physical-browser acceptance pending | Console can execute selected Python/R/Flow independently of source editor; preserve Python/R state, histories and drafts; report Flow native-only limits and execution failures |
| Browser Python/R session snapshot export/import | partial / bounded scalar/vector JSON snapshots cross-platform CI accepted in PR #31; physical browser acceptance pending | Explicitly export and restore supported live interpreter values through a local file, reject tampering and stale sessions, verify live Pyodide/webR and cross-platform browser interactions; no implicit or arbitrary-object serialization |
| Explicit Python/R variable transfer | partial / bounded plain scalar and atomic-vector copy wired; real CPython/Rscript query tests and native Flow HTTP accepted on Ubuntu/macOS CI; physical-browser Pyodide/webR round-trip unverified | Copy typed scalars/vectors both ways between persistent runtimes, reject unsupported objects/NA/NaN and active bindings, verify independent real-browser and cross-platform execution |
| Variable inspector | partial / native Python and R bounded metadata snapshots cross-platform HTTP accepted; opt-in browser rendering of native R metadata cross-platform Node/Flow HTTP CI accepted (physical-browser pending); native Python exact-builtin nested metadata tree cross-platform CI accepted (unit/HTTP/DOM); R array dimensions and failed-lazy-binding recovery cross-platform HTTP accepted; browser R bounded two-level plain-list tree and active-binding protection accepted by Ubuntu/macOS CI #40090303070 (real Rscript, Node, native Flow/HTTP); side-effect-free bounded browser Python nested inspection accepted by cross-platform CI #40140193181 (real CPython/Node/native Flow HTTP), but real Pyodide physical-browser acceptance and arbitrary-object introspection remain missing | Nested objects / types / dimensions inspectable and refresh after execution |
| Plot viewer | partial / native R PDF graphics capture accepted by real Ubuntu/macOS Flow/R HTTP CI #40168433903; actual physical-browser PDF rendering remains unverified | png/svg plot history, zoom, save and deterministic device lifecycle |
| Project explorer | partial / browser Pages open/create/save and confirmed active-file delete with baseline conflict checks; 10 regression tests V8-shim passed; physical-browser deletion unverified | Open project, tree navigation, source-file creation and save; scoped delete is implemented, copy-verify-delete rename implemented with non-atomic filesystem race limits; physical-browser acceptance remains missing |
| Data viewer | partial / CSV/TSV and browser Python/webR table snapshots; native Rscript data.frame/matrix bounded preview accepted by Ubuntu/macOS native Flow/HTTP CI #40163391932 (physical-browser pending); no remote data browsing | Interactive sortable/filterable tabular datasets including missing values |
| Completion / language server | partial / browser Python/R runtime prefix completion cross-platform CI accepted; Flow lexical completion accepted by Ubuntu/macOS CI; explicit-type Flow struct and evolution-state member completion cross-platform CI accepted (#40095770668, 473 JS passes, 2 skips per platform, native Flow/HTTP accepted); physical-browser verification pending; full semantic/LSP completion missing | R, Flow and Python completion/diagnostics |
| Packages pane | partial / browser Python and webR inventory/install; native Rscript installed-library inventory accepted by Ubuntu/macOS native Flow/R HTTP CI #40168902761; native installed-package loading accepted by Linux/macOS real Flow/R HTTP CI #40170771561 (physical-browser acceptance pending); native CRAN installation through persistent Flow/R kernel and real offline source-package install/restart accepted on Ubuntu/macOS CI #40174758087 (PR #50 merged); public CRAN download and physical-browser acceptance unverified; native user-library update passed real offline Linux/macOS Rscript/Flow HTTP CI #40182126305 (physical-browser pending); user-library removal passed real Linux/macOS Flow/R CI #40178422509 (physical-browser pending) | List, install, update with environment-aware package sources |
| Git pane | partial / native Flow status, diff, stage, unstage and commit previously accepted cross-platform; branch list/create/switch accepted by CI #40117614745 on Ubuntu/macOS (PR #37 merged); physical-browser verification missing; branch deletion, remote tracking and merge missing | Status, diff, stage, unstage, commit and branch operations |
| Help pane | partial / browser Python live-global/builtin docstrings and installed R Rd help wired; Node/V8 contract tests, live Pyodide/webR and physical browser unverified; Flow help missing | Context-aware language/function docs |
| Find / replace / cross-file search | partial / Node + V8-tested | Literal in-buffer find next/previous, single/all replacement and project-wide search implemented; incremental indexing and physical-browser verification missing; opt-in bounded regex and Unicode whole-word matching passed Linux/macOS Node CI #40186276335 |
| Percent-delimited source cells | partial / lexical scanner unified across native editor and Pages, Node/HTTP acceptance pending; physical-browser execution unverified | Run only the active `# %%` code cell in Flow/R/Python; markdown and empty cells do not execute |
| Portable mixed-language FlowStudio notebooks (`.fsnb`) | partial / source and display-only outputs round-trip in Node tests; cross-platform CI accepted in PR #33; physical-browser file interaction unverified | Import/export exact Flow/R/Python tagged source and bounded saved text/PNG results, verify physical-browser round-trip, no interpreter-state restoration claims |
| Sequential percent-cell notebooks | partial / Python and R Run All wired with explicit per-cell Python/R/Flow language tags (cross-platform CI accepted; opt-in native Rscript notebook route cross-platform Node/Flow HTTP CI accepted; real browser pending); bounded browser-local text/Python PNG output recovery across reload; native and physical-browser acceptance unverified | Execute cells in order, retain interpreter state, show per-cell output and stop on error |
| Jupyter `.ipynb` import/export | partial / browser UI wired and Node regression coverage; bounded output recovery is separate from `.ipynb` import/export; physical-browser file round-trip and live Python/R kernels unverified | Import/export nbformat 4 Python/R code and Markdown cells through file picker/download; validate with nbformat; preserve source; verify live outputs in Chromium and cross-platform acceptance |
| R Markdown / Quarto | partial / offline HTML report export from Python/R percent-cell notebooks; no Quarto/R Markdown rendering | Render notebook with inline plots and HTML export; verify actual Quarto/R Markdown format compatibility |
| Source debugger | partial / native CPython breakpoint/step/next/finish/continue/stop and bounded stack inspection passed cross-platform Flow/HTTP CI #40126891635; numeric-local conditional breakpoints accepted by Ubuntu/macOS CI #40144484561 (real CPython and Flow HTTP); opt-in raised-exception pause passed Ubuntu/macOS CI #40148434956 (real CPython and Flow HTTP); physical browser and R/Flow debugging missing | Breakpoints, stack, variables, step execution |
| Remote/server mode | missing | Authenticated, origin-aware multi-user sessions with isolation |
| Diagnostics / profiling | partial / native CPython bounded line tracing cross-platform CI accepted; native R parse-only diagnostics passed Ubuntu/macOS native Flow/HTTP CI #40156177608; physical-browser acceptance pending; physical-browser acceptance pending | Resource/time tracing and useful language-specific diagnostics |
| Cross-platform packaging | missing | Installable signed/reproducible macOS and Linux releases |
| Accessibility | partial / unverified | Full keyboard navigation, screen reader labels, resize and contrast checks |
| RStudio project import | partial / browser-local .Rproj editor; Node-tested, native unverified | Open and preserve basic .Rproj project settings |



## 2026-10-25: native R installed-library inventory (cross-platform native acceptance passed)

The persistent Rscript kernel reads the actual installed package database via
`utils::installed.packages()` using read-only `K` IPC. Flow owns the
intent/origin-gated `POST /api/packages/r` route. The browser session serializes
package reads with execution/reset, rejects stale responses and validates
bounded names, versions and counts. The existing package pane displays the
selected native R library, with native R installation explicitly unsupported
and disabled. Browser webR and native Rscript have separate libraries.

Real Rscript/C IPC, Flow-owned HTTP, Node transport/UI and optional physical-
browser acceptance scenarios were added. **Cross-platform native acceptance
passed** in [CI #40168902761](https://github.com/godofecht/FlowStudio/actions/runs/40168902761)
on Ubuntu 24.04 and macOS 14: all four jobs succeeded; each source/transport
job recorded 539 JavaScript passes, two skips and zero failures, plus 76
Python tests (11 skips). Both native jobs compiled Flow 2.0.0, exercised the
actual Rscript package database through the Flow-owned localhost route and
completed packaging. [PR #48](https://github.com/godofecht/FlowStudio/pull/48)
merged as [aae909e](https://github.com/godofecht/FlowStudio/commit/aae909e4f03cfbe7fa3fbb63ba6f6a0266dcb135).
**Actual physical-browser acceptance remains unverified.** No hosted CI
configuration changed. Full RStudio parity is not claimed.

## 2026-10-25: native Rscript PDF graphics capture (implementation; acceptance pending)

The persistent Rscript kernel opens a real built-in `grDevices::pdf` graphics
device before each native R execution, closes it on exit, and exposes bounded
PDF output through read-only `P` IPC. Flow owns the intent/origin-gated
`POST /api/plot/r` route. The browser validates hex-encoded PDF and
displays it after native R source/console execution with history, zoom and
download. Text-only evaluations must not return stale plots. This avoids
X11/Cairo and third-party R package dependencies. It is a real R graphics
device, not a mock.

**Status: partial / native acceptance pending.** Source/transport tests passed
on Ubuntu and macOS. Earlier SVG attempts failed real R IPC acceptance on both
platforms: macOS lacked X11, and a pre-existing `on.exit` call discarded
the capture finalizer. The cleanup was fixed; PDF-only capture now awaits
independent cross-platform acceptance. Physical-browser rendering has not
been exercised. SVG/PNG export, multiple plot pages, notebook attachments,
user-managed devices, restart persistence and complete RStudio plot parity
remain outstanding. No hosted CI configuration was changed.

## 2026-10-25: native Rscript table previews (implementation; acceptance pending)

The persistent native R kernel adds a read-only `T` IPC operation for named
base `data.frame` and classless atomic matrix variables. Flow owns the
origin/intent-gated `POST /api/table/r` route; the existing native R browser
session serializes table requests with execution and reset. The environment
View action displays the same bounded sortable/filterable grid as browser
webR, with up to 200 rows, 32 columns, 160 characters per cell and a
65 KiB output budget. NA cells are blank, plain factors display labels,
and classed/unsupported columns are explicitly marked. Active bindings,
invalid variable names and non-tabular objects are rejected without eval.
As with existing environment inspection, forcing a lazy R promise may
still have side effects; this is not a sandbox.

Automated coverage has been added for real Rscript IPC, Flow HTTP
origin/intent rejection, browser response validation and reset races,
and optional physical-browser View interaction. **Status: partial / independently accepted by native Ubuntu 24.04 and
macOS 14 Flow/HTTP CI #40163391932.** The real Rscript IPC harness,
Flow-owned localhost HTTP table acceptance and source/transport suites passed.
Each source/transport platform ran 527 JavaScript tests (525 passed, two
skipped, zero failures); Python unittest ran 76 tests with 11 skips.
[PR #46](https://github.com/godofecht/FlowStudio/pull/46) merged as
[33dcc2b](https://github.com/godofecht/FlowStudio/commit/33dcc2b2f047bc050b858736296b9301d7f4ffc1)
after [CI #40163391932](https://github.com/godofecht/FlowStudio/actions/runs/40163391932)
completed all four jobs successfully. **Actual physical-browser View acceptance
has not run**, so this is not full browser or RStudio parity. No hosted CI
configuration was changed.
Native R plotting, package management, debugging and remote sessions
remain unimplemented; this is not RStudio parity.

## 2026-10-25: opt-in native Rscript execution from the browser IDE (cross-platform native CI accepted; physical browser pending)

The browser IDE now offers an explicit R engine selector: the existing webR
0.6.0 browser workspace remains the default, while the optional native
Rscript engine (only when served by Flow on loopback port 8751) sends R source,
console commands and notebook cells to the **existing real persistent R kernel**
through the Flow-owned `/api/run/r` route. Native environment inspection uses
`/api/inspect/r`, maps bounded metadata and nested list nodes to the existing
accessible tree, and rejects malformed or oversized responses. Native syntax
checks use the same selected kernel; native reset uses `/api/reset/r` and is
serialized after in-flight requests. Stale results are discarded on reset.

Browser webR and native Rscript are **separate workspaces**. Package management,
data-frame previews, help, completion, variable transfer, snapshot export/import
and graphical plot capture are not yet implemented for native Rscript mode:
they explicitly report unavailable rather than silently operating on webR's
different workspace. Switching back to webR restores the independent browser
session. The existing browser-only execution path remains the default and
GitHub Pages never connects to localhost.

Tests cover native transport/intent headers, serialized requests, reset,
source/error handling, bounded environment-tree validation, origin rejection,
unsupported operations and UI wiring. The underlying native Flow/R HTTP
execution and persistence were independently accepted on Linux and macOS in
earlier CI, but **this new browser routing passed cross-platform Node/native Flow HTTP CI but
remains unverified in an actual physical browser**. No hosted CI configuration was changed.
[PR #45](https://github.com/godofecht/FlowStudio/pull/45) merged as
[825f539](https://github.com/godofecht/FlowStudio/commit/825f539c59be886103c360c0f5cfe5a789998279)
after [CI #40159464872](https://github.com/godofecht/FlowStudio/actions/runs/40159464872)
completed all four jobs on Ubuntu 24.04 and macOS 14. Each source/transport
platform recorded 522 JavaScript tests, 520 passing, two skips and zero failures,
plus 76 Python unit tests. Both native jobs compiled Flow 2.0.0 and passed
real persistent Rscript/Flow HTTP acceptance and packaging. The new
physical-browser native R scenario **was not executed**. This is not complete
RStudio parity.



## 2026-10-25: non-executing native R syntax diagnostics (cross-platform native acceptance passed)

The Flow-owned localhost backend now offers an intent/origin-gated
`POST /api/check/r` route backed by the **same persistent real Rscript
kernel** used for native R execution. A new `C` IPC operation calls
`parse(text=source, keep.source=TRUE)` without `eval`, preserving
workspace state and reporting R parser errors with source positions.
The native browser IDE selects this parser for R syntax checks when
served by Flow; GitHub Pages retains the existing webR parser path.
The request and response are bounded by the existing transport limits.

Regression coverage adds real-R IPC checks for valid/invalid syntax,
non-execution and continued session persistence; Flow-owned HTTP smoke
checks for intent/origin enforcement and parse status; and Node browser
tests for route selection, locations, transport failures and remote
origin rejection. **Status: partial / independently accepted on Ubuntu 24.04 and macOS 14
native Flow/HTTP CI; physical-browser acceptance remains unverified.** [PR #44](https://github.com/godofecht/FlowStudio/pull/44) merged as
[0b57013](https://github.com/godofecht/FlowStudio/commit/0b570137c649f6c8e2dc4aaa64bcdc0966124d80)
after [CI #40156177608](https://github.com/godofecht/FlowStudio/actions/runs/40156177608)
passed all four jobs. Each source/transport platform recorded 513 passing
JavaScript tests, two skips and zero failures, plus 76 Python unit tests.
Both native jobs compiled Flow 2.0.0, exercised actual Rscript parser-only
IPC and the intent-gated Flow HTTP route, and completed packaging.
This is not interactive R debugging, remote R sessions or full RStudio
parity. Hosted CI configuration is unchanged.

## 2026-10-25: native CPython pause on raised exceptions (cross-platform native acceptance passed)

The Flow-owned localhost Python debugger now accepts an optional boolean
`pause_on_exception` request flag. When enabled, CPython's actual exception
trace events pause execution at the originating FlowStudio source frame,
including exceptions that are subsequently caught. The debugger displays
bounded exception **type and line only**; it never calls user exception
`__str__` or `__repr__`. Continue, stepping and stop remain available.
With the flag enabled and no line breakpoints, source runs until an exception
or completion instead of stopping automatically on line one. Legacy requests
retain their original first-line stepping behavior.

A browser checkbox exposes the mode on the native localhost IDE. New real
CPython unit tests, Node client/UI tests, Flow-owned HTTP smoke assertions
and an opt-in physical-browser scenario cover caught and uncaught exceptions,
metadata validation, persistence, and safe previewing. The browser harness
still requires real interpreter downloads and native Flow execution.

**Status: partial / cross-platform native acceptance passed.**
[PR #43](https://github.com/godofecht/FlowStudio/pull/43) merged as
[74d942b](https://github.com/godofecht/FlowStudio/commit/74d942b8bbe37cc58ca4fd6078178129d4777892)
after [CI #40148434956](https://github.com/godofecht/FlowStudio/actions/runs/40148434956)
passed all four jobs on Ubuntu 24.04 and macOS 14. Each source/transport
platform passed 508 Node tests, 2 skips, 76 Python unit tests (including
real CPython debugger cases and verification-harness tests), and native
transport checks. Both native jobs compiled Flow 2.0.0, passed actual
Flow-owned localhost HTTP exception-pause acceptance with real CPython,
persistent R/Python checks, and produced platform tarballs.
The new physical-browser exception-pause scenario **has not been run**.
This is not R or Flow source debugging, exception handling for external
library frames, or RStudio parity. No hosted CI configuration was changed.

## 2026-10-25: numeric conditional CPython breakpoints (acceptance pending)

The existing Flow-owned localhost debugger now accepts both unconditional
line breakpoints and narrowly scoped numeric-local conditions, entered as
`5?counter>=3`. Conditions are checked against live CPython frame locals
at line events; the debugger never calls `eval`, arbitrary user-defined
comparisons or user object representations. Only exact built-in `int` and
`float` locals compared to finite decimal literals are eligible. Invalid
syntax, out-of-range and duplicate lines are rejected by the browser client
and native kernel. Existing breakpoint/step/next/finish/continue operations
retain their semantics.

Real CPython unit tests and Node transport/parser tests were added.
**Status: partial / cross-platform native acceptance passed; real
physical-browser acceptance not run.** [PR #42](https://github.com/godofecht/FlowStudio/pull/42)
merged as [2e2934a](https://github.com/godofecht/FlowStudio/commit/2e2934ac4d4ec0840c367fef8272faab098092de)
after [CI #40144484561](https://github.com/godofecht/FlowStudio/actions/runs/40144484561)
completed all four jobs on Ubuntu 24.04 and macOS 14. Each source/transport
platform passed 505 Node tests, 2 skips and zero failures, plus 68 real Python
unit tests. Both native jobs compiled Flow 2.0.0 and passed real localhost HTTP
conditional breakpoint acceptance, R/Python kernels and packaging.
An opt-in physical-browser native-debugger scenario was added but **not run**.
This is not R or Flow debugging, remote session support, or RStudio parity.
No hosted CI configuration was modified.

## 2026-10-24: side-effect-free browser Python environment inspector (native acceptance passed)

The Pyodide worker previously inspected globals with arbitrary `repr(v)`,
which could execute user-defined methods, raise exceptions or block refresh.
The new Python helper captures bounded metadata from exact built-in types and
nested list/tuple/dict values only, preserving opaque user objects without
calling their `__repr__`, `__len__`, `__iter__` or descriptors.
A Flow allowlisted native asset route serves the same helper under `/app/`.
Real CPython tests cover hostile objects, cycles, nested metadata and limits;
Node worker tests cover helper loading and malformed response rejection.
The physical-browser suite now also checks that a hostile object does not
break Pyodide environment refresh.

**Status: partial / cross-platform native and source acceptance passed; real
Pyodide physical-browser acceptance remains unverified.** [PR #41](https://github.com/godofecht/FlowStudio/pull/41)
merged as [f7f1713](https://github.com/godofecht/FlowStudio/commit/f7f171355416edc4c3014f2c2a4ee1113a688f62)
after [CI #40140193181](https://github.com/godofecht/FlowStudio/actions/runs/40140193181)
passed all four jobs on Ubuntu 24.04 and macOS 14. Each platform passed
503 Node tests, 2 skips, zero failures, and 62 Python tests. Native Flow 2.0.0
compilation, live HTTP acceptance, R/Python kernels and packaging passed.
The first CI attempt failed because an existing source contract test asserted
the removed `repr`-based inspection path; the test now asserts the actual bounded
helper and its response validation. No hosted CI configuration was changed.
This improves Python environment inspection safety and depth, but does not
validate RStudio feature parity.
Flow remains the native HTTP/backend owner; the browser Python interpreter
remains Pyodide.

## 2026-10-24: real-browser acceptance harness (unverified)

An opt-in Playwright runner now opens the checked-in FlowStudio browser IDE in
Chromium/Firefox/WebKit, exercising actual Pyodide and webR downloads and
source/console execution, live interpreter state, Python session snapshot
export/import, source download, notebook execution, Python PNG plotting, webR
canvas plotting, and R reset. When explicitly
run against the native Flow-owned localhost server, it also checks real Flow
compilation and execution. It refuses remote execution targets. The harness
includes independent real-static-asset and loopback safety tests. See
[physical browser acceptance instructions](PHYSICAL_BROWSER_ACCEPTANCE.md).

**Status: physical-browser acceptance NOT YET RUN or independently verified.**
The acceptance *harness and static-asset safety tests* passed
[CI #40132144052](https://github.com/godofecht/FlowStudio/actions/runs/40132144052)
on Ubuntu 24.04 and macOS 14: all four jobs passed, including 501 Node passes,
2 skips and 0 failures per platform, 58 Python unittest passes per platform,
real native Flow 2.0.0 compilation, R/Python HTTP acceptance and packaging.
These checks **did not run a physical browser or download real Pyodide/webR**.
This adds an executable acceptance gate, not evidence that Pyodide/webR ran
successfully in Chromium or that RStudio parity has been achieved. No hosted CI
configuration was modified.

## 2026-10-24: CPython step-over and step-out (acceptance pending)

Native debugger commands now include **Step over** and **Step out**. The real
CPython trace engine counts FlowStudio source frames, so Step over skips
nested calls and resumes at the next line in the same or calling frame;
Step out resumes when the current source frame returns. Explicit
breakpoints in called frames still take precedence. Step out from a
top-level source frame runs to completion. Both operations reuse the
persistent Python kernel and Flow-owned localhost intent/origin-gated routes;
GitHub Pages does not emulate them. The browser provides separate accessible
controls. Real CPython unit tests, browser route/control tests and live HTTP
acceptance have been added. **Status: partial / cross-platform native CI accepted; physical-browser acceptance still missing.** [PR #39](https://github.com/godofecht/FlowStudio/pull/39)
merged as [981790f](https://github.com/godofecht/FlowStudio/commit/981790fa5687a4d59998c86eff84dd07444c1b56)
after [CI #40126891635](https://github.com/godofecht/FlowStudio/actions/runs/40126891635)
passed all four Ubuntu 24.04/macOS 14 jobs. Each source/transport job
recorded 501 passing Node tests, 2 skips and zero failures; real CPython
step-over/step-out unit tests, native Flow compilation, live HTTP acceptance
and platform packaging also passed.
No claim of R/Flow debugger support or RStudio parity is made.

## 2026-10-24: native Python source debugger (cross-platform native acceptance passed)

The Flow-owned HTTP router now exposes explicit intent/origin-gated Python
debugging operations: start with source and up to 64 line breakpoints, step,
continue, stop and status. A dedicated background CPython thread executes
source in the existing persistent Python namespace. Breakpoints genuinely
pause execution before the selected source line; stepping pauses at the next
line event. The native browser panel displays a bounded call stack and
safe exact-builtin scalar previews without evaluating arbitrary user reprs.
While debugging is active, ordinary Python execution is refused; session
reset terminates the interpreter. Empty breakpoint sets pause at the first
executable line. The debugger is not a sandbox and runs with the user's
local permissions. No remote debugging or browser-only emulation is claimed.

New real-CPython unit tests cover nested frames, variable previews,
breakpoints, step/continue, explicit stop and exceptions. Browser Node tests
cover validation, UI controls and fixed HTTP routes. Native HTTP smoke
exercises actual debugger execution, persistent state, request rejection
and the origin gate through the compiled Flow router. Local CPython
debugger-engine tests passed (6 tests). [PR #38](https://github.com/godofecht/FlowStudio/pull/38)
passed [CI #40122749072](https://github.com/godofecht/FlowStudio/actions/runs/40122749072):
all four jobs succeeded on Ubuntu 24.04 and macOS 14. Each platform passed
501 JavaScript tests (2 skips, zero failures) and 7 real CPython debugger
unit tests; native Flow 2.0.0 compilation, real HTTP breakpoint/step/stop
acceptance, persistent-session checks and packaging also passed. Merged as
[379c1d2](https://github.com/godofecht/FlowStudio/commit/379c1d28f44d9bc20d76f19507bfe470876330b1).
Physical-browser interaction,
R and Flow source debugging, conditional breakpoints, expression evaluation,
watchpoints and advanced stepping are missing. Status: **partial / cross-platform native CI accepted; physical browser pending**.

## 2026-10-24: local Git branch management (cross-platform native acceptance passed)

The Flow-owned native router now supports read-only `/api/git/branches`,
explicit local `/api/git/branch/create` and `/api/git/branch/switch` routes.
The browser Git pane provides branch listing, name input and separate
confirmation for creating and switching. Git executes fixed argument vectors
without a shell, refuses invalid ref names, disables hooks and limits output
and process runtime. Switching is refused with HTTP 409 when the server
working tree contains tracked changes or non-ignored untracked files; Git
itself remains responsible for checkout safety. Branches belong to the
**server working tree**, not the browser-picked project directory. GitHub
Pages cannot invoke these native routes.

Added JavaScript route/confirmation/concurrency regression tests and real-Git
HTTP fixture assertions for branch creation, duplicate and invalid names,
dirty-tree rejection, successful checkout and cross-origin rejection. [CI #40117614745](https://github.com/godofecht/FlowStudio/actions/runs/40117614745)
subsequently completed all four jobs successfully on Ubuntu 24.04 and
macOS 14: JavaScript/source/transport suites, Flow 2.0.0 compilation,
real-Git native HTTP acceptance and packaging. [PR #37](https://github.com/godofecht/FlowStudio/pull/37)
merged as [fce088a](https://github.com/godofecht/FlowStudio/commit/fce088a068624c4641ecee3cc1e5a07763239400).
**Status: partial / native cross-platform acceptance passed; physical-browser
acceptance missing**. Remote branch operations, merges,
rebases and branch deletion are not implemented.

## 2026-10-24: selective Git unstage (cross-platform native acceptance passed)

The Flow-owned native Git backend now supports `POST /api/git/unstage` for a
single literal relative path or subdirectory in the server working tree. The
implementation invokes `git restore --staged -- :(literal)<path>` with a
fixed argument vector, ten-second timeout, 128 KiB response limit and the
existing origin/intent gate. It restores the index entry from `HEAD` without
discarding working-tree edits or implicitly touching unrelated staged files.
An unborn branch without `HEAD` cannot use this operation; Git errors are
reported rather than silently falling back to destructive index changes.
The browser requires an explicit confirmation and disables the control on
GitHub Pages. Automated tests cover client validation, the UI write lock,
origin rejection and isolated real-Git staging/unstaging of tracked and newly
added files. **Status: partial / native acceptance passed; physical-browser acceptance
missing.** [PR #36](https://github.com/godofecht/FlowStudio/pull/36)
merged as [608efc6](https://github.com/godofecht/FlowStudio/commit/608efc61221917e99263801a208cac879acbcf39)
after [CI #40113113929](https://github.com/godofecht/FlowStudio/actions/runs/40113113929)
passed all four jobs on Ubuntu 24.04 and macOS 14. Each source/transport
platform passed 492 Node tests, zero failures and two skips; native jobs
compiled Flow 2.0.0, passed live HTTP acceptance and isolated real-Git
selective unstage assertions for tracked and newly added paths. No physical
Chromium/Safari Git interaction has been independently verified.

## 2026-10-24: native Git stage and commit (independent acceptance pending)

The Flow-owned localhost backend now offers fixed-argv Git staging of an
explicit **literal** relative path, a read-only staged diff, and commit of
the existing index with a user-entered message. The browser requires separate
confirmation for staging and committing and explicitly warns that the target
is the native server's working tree, not a browser-selected folder. It
never accepts arbitrary commands or a repository path. Git runs without shell
interpolation, with a 10-second process-group timeout and a 128 KiB output
limit. The commit route disables Git hooks and signing for deterministic
local acceptance. It does not push, change branches, or stage all files
implicitly. Committing includes **all** previously staged changes, even
those staged outside FlowStudio; review staged diff before committing.

**Status: partial / cross-platform native acceptance passed; physical-browser
acceptance pending.** [PR #35](https://github.com/godofecht/FlowStudio/pull/35)
merged as [ea6b007](https://github.com/godofecht/FlowStudio/commit/ea6b0073741555aeaed952771e89a225f96ff20c)
after [CI #40109268078](https://github.com/godofecht/FlowStudio/actions/runs/40109268078)
passed all four jobs on Ubuntu 24.04 and macOS 14. Each source/transport
platform passed 491 Node tests with zero failures, and the native jobs
compiled Flow 2.0.0, exercised the real Flow-owned HTTP router and passed
isolated real-Git stage, staged diff and commit acceptance. The fixture
verified metacharacter-safe literal paths, a deliberately failing hook that
was not executed, unchanged untracked files, invalid-path rejection and
cross-origin rejection. No physical Chromium/Safari Git interaction has been
verified. Git branch operations, selective unstage and full RStudio Git
parity remain outstanding.

## 2026-10-24: portable mixed-language notebook files (cross-platform CI accepted)

FlowStudio now supports a dedicated **`.fsnb` v1** JSON notebook file for
portable, browser-local import/export of exact percent-cell source, default
language, explicit Flow/R/Python cell tags, and previously captured bounded
text/PNG outputs. The file is deliberately **not** presented as a
single-kernel Jupyter `.ipynb`: mixed Flow/R/Python notebooks cannot be
executed by an ordinary Jupyter kernel without additional language runtimes.
Imported outputs are rendered as **saved results**, not re-executed.
Interpreter variables, installed packages, active sessions and external files
are **not** restored. Existing `.ipynb` support is unchanged.

The codec validates format/version, exact schema keys, source/cell/result
limits, unique ascending code-cell indices, matching runtime tags, bounded
text and PNG payloads. It rejects malformed or oversized files before
changing the editor. The same checked-in `docs/app/` modules are served by
GitHub Pages and the Flow-owned native localhost asset router; native Flow
compilation and HTTP execution routes are unchanged.

**Status: partial / cross-platform CI accepted; physical-browser acceptance
outstanding.** [PR #33](https://github.com/godofecht/FlowStudio/pull/33)
passed [CI #40099804982](https://github.com/godofecht/FlowStudio/actions/runs/40099804982):
all four jobs succeeded on Ubuntu 24.04 and macOS 14, with **480 Node tests
passing, two skips and zero failures per platform**, plus real native Flow
compilation, HTTP acceptance and packaging. Merged as
[d55a059](https://github.com/godofecht/FlowStudio/commit/d55a059f4b693e84a00411ee1cb5eb4d70ef1098).
No physical Chromium/Safari file-picker or real Pyodide/webR mixed-language
execution has been independently validated. The file is not an execution
environment snapshot, and broader RStudio notebook parity remains unmet.

## 2026-10-24: explicit browser Python/R session value snapshots (cross-platform CI accepted)

The browser workspace now offers **Export session values** and **Import
session values** for the selected persistent Python or R interpreter.
Exports enumerate actual interpreter bindings and use the already implemented
typed variable transfer protocol, preserving only supported plain built-in
scalars/homogeneous lists or R classless atomic vectors. The browser downloads
a local JSON file; import requires an explicit user-selected file and overwrite
confirmation. The Flow-owned native HTTP router serves the exact same browser
module through an allowlisted read-only asset route; it does not serialize
native Flow state, change Flow syntax or add a remote code-execution endpoint.

Snapshots contain at most 64 values and 128 KiB of JSON; individual values
retain the existing 256-item, 32 KiB protocol limits. Unsupported variables
are counted as omitted, inspection truncation is reported, and snapshot
validation rejects duplicate names, unexpected fields, malformed values and
wrong-language restores before interpreter mutation. Session generation and
selected language are checked after asynchronous operations. An import is
**not transactional**: if a destination rejects a later value, earlier
imports remain. Only explicitly exported values are restored; functions,
packages, files, open connections, native Flow variables and arbitrary
objects are not persisted. Export files may contain sensitive user data and
remain entirely under the user's control.

**Status: partial / cross-platform CI accepted; physical-browser
acceptance pending.** Eleven isolated tests passed in a direct V8 harness,
and [PR #31](https://github.com/godofecht/FlowStudio/pull/31) passed
[CI #40091815932](https://github.com/godofecht/FlowStudio/actions/runs/40091815932):
all four jobs succeeded on Ubuntu 24.04 and macOS 14, including the Node
regression suite, real Flow compilation, native HTTP asset acceptance and
packaging. Merged as
[8740783](https://github.com/godofecht/FlowStudio/commit/87407832458155a1f20eccd4dd342161dc9f2e99).
These tests do **not** constitute real physical-browser Pyodide/webR
export/import acceptance. The broader RStudio session-persistence criterion
remains unmet.

## 2026-10-24: bounded browser R nested environment inspector (acceptance pending)

The browser webR environment inspector now enumerates real `.GlobalEnv`
bindings without evaluating active bindings or calling `str()` on user
objects. Inspector helper calls resolve explicitly in base/utils namespaces,
so user-masked global functions cannot intercept inspection. It emits a bounded depth-two tree of ordinary R lists (12 children
per container, 256 total nodes, 128 root variables, 65 KiB metadata budget),
with scalar previews limited to classless built-in atomic values. Matrix
dimensions and data-frame classes remain visible; classed objects are not
traversed. Each binding that fails during inspection is isolated and shown
as unavailable rather than aborting the entire snapshot. The Pages and native
`/app/` environment panels render nested nodes as accessible, expandable
text-only details, and report truncation. The R execution and Flow-owned
native routing architecture are unchanged.

**Status: partial / cross-platform CI accepted; physical-browser execution pending.**
[PR #30](https://github.com/godofecht/FlowStudio/pull/30) passed all four
jobs in [CI #40090303070](https://github.com/godofecht/FlowStudio/actions/runs/40090303070)
on Ubuntu 24.04 and macOS 14, including Node DOM/parser regression suites,
real Rscript execution of the exact generated inspector query, active-binding
and masked-global protections, native Flow compilation, HTTP acceptance and
packaging. Merged as [899f4cf](https://github.com/godofecht/FlowStudio/commit/899f4cfa158713165674163a41a698c100fb8d09).
No physical Chromium/Safari webR execution has been independently verified.
Inspection still may force lazy promises, which can have side effects;
it does not implement arbitrary object traversal or full RStudio parity.

## 2026-10-24: explicit typed browser Python/R variable transfer (cross-platform CI accepted)

The Environment pane now has a manual Python → R / R → Python variable
copy operation. A bounded tagged scalar/vector protocol uses actual existing
Pyodide worker and webR session instances, not a synthetic interpreter or
server-side substitute. Python exports exact built-in scalars or homogeneous
lists/tuples; R exports classless atomic numeric/logical/character vectors.
Target variables are assigned into the existing persistent interpreter globals.
Both directions reject malformed identifiers, unsupported or missing values,
non-finite/unsafe numbers, oversized data and active R bindings. Transfers
do not run during source execution; a reset between export and import prevents
the destination assignment. The Flow-owned router explicitly serves the
same transfer-controller asset on localhost. No Flow language or compiler
syntax was modified.

**Status: partial / cross-platform CI accepted, physical-browser execution
outstanding.** [PR #29](https://github.com/godofecht/FlowStudio/pull/29)
passed [CI #40088230707](https://github.com/godofecht/FlowStudio/actions/runs/40088230707):
all four jobs succeeded on Ubuntu 24.04 and macOS 14. Quality suites
passed 436 Node tests per platform (one optional Rscript test skipped
because Rscript is not installed in the quality jobs). Native acceptance
ran all 10 transfer tests with **zero skips**, including actual CPython
and Rscript execution of the generated queries, then built the real Flow
server, exercised live HTTP routes and packaged both platforms. Direct
V8 checks also passed. No physical browser with live Pyodide/webR has
been exercised, so browser interoperability remains unverified. See
[TYPED_VARIABLE_TRANSFER.md](TYPED_VARIABLE_TRANSFER.md). Arbitrary Python
objects, R data frames/matrices, nested structures, missing-value transfer,
Flow values and automatic notebook cross-language state sharing remain
unsupported.

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
| Plot viewer | partial / Python PNG history and native R PDF capture via real Rscript graphics device implemented with bounded Flow-owned plot route, Node/IPC/HTTP/physical-browser acceptance added but not yet verified | png/svg plot history, zoom, save and deterministic device lifecycle |
| Project explorer | partial / browser Pages open/create/save and confirmed active-file delete with baseline conflict checks; 10 regression tests V8-shim passed; physical-browser deletion unverified | Open project, tree navigation, source-file creation and save; scoped delete is implemented, copy-verify-delete rename implemented with non-atomic filesystem race limits; physical-browser acceptance remains missing |
| Data viewer | partial / CSV/TSV plus bounded Python/R environment table snapshots wired; real Pyodide/webR and physical browser unverified | Interactive sortable/filterable tabular datasets including missing values |
| Completion / language server | partial / browser Python AST and R parse-only syntax diagnostics; browser Python/R global-symbol prefix completion implemented with bounded interpreter namespace enumeration and keyboard insertion, pending cross-platform CI and physical-browser verification; native Flow strict compile-only diagnostics; Flow completion and member-aware completion missing | R, Flow and Python completion/diagnostics |
| Document outline | partial / browser line-scan symbol list for Flow, Python and R wired into the workspace with click-to-symbol; Node suites passed in Linux x86-64 and macOS arm64 CI, and a headless-Chromium CDP run exercised click, shortcut, keyboard and document-switch navigation locally; physical-browser acceptance missing | List buffer symbols, navigate to them, and keep the outline in sync with the active buffer |
| Packages pane | partial / browser Python inventory/install and webR 0.6.0 inventory/install; mocked Node tests, live interpreters unverified | List, install, update with environment-aware package sources |
| Git pane | partial / Flow-owned native read-only working-tree status and unstaged diff accepted on Ubuntu/macOS CI #40104296753; physical-browser acceptance pending; stage/commit/branch missing | Status, diff, stage, commit and branch operations |
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


## 2026-10-24: source-local typed Flow member completion (cross-platform CI accepted)

The browser editor now offers Ctrl/Command+Space completion for fields on explicitly typed Flow `struct` variables and accessible `flow` evolution state members. It recognises typed function parameters, module bindings and `let`/`let mut` locals, including lexical shadowing; unknown and inferred receiver types intentionally return no member suggestions. The implementation uses the actual Flow 2.x struct/state syntax, without invoking Python/R or claiming compiler-backed inference. Ten focused and pre-existing completion tests passed in a V8 execution harness. PR #32 was merged as b1089665bad127c7726d1ccb9b434f606feb2177 after [CI #40095770668](https://github.com/godofecht/FlowStudio/actions/runs/40095770668) completed all four jobs successfully: Ubuntu 24.04 and macOS 14 each recorded **473 JavaScript passes, 2 skips and zero failures**, plus native Flow compilation, HTTP acceptance and packaging. **Physical Chromium with real Pyodide/webR is still unverified.** This remains **partial**, not RStudio parity.

## 2026-10-24: native Git status and diff (acceptance pending)

FlowStudio's Flow-owned localhost server exposes fixed-argv, read-only
`POST /api/git/status` and `POST /api/git/diff` endpoints for the server
working tree, **not** the browser-selected folder. The browser IDE has a
collapsible Git pane. Hosted Pages disables the controls. Requests require
the existing intent and origin checks. Git status disables filesystem
monitor hooks; diff disables external drivers and text conversion.
Both commands have five-second deadlines and 128 KiB response limits.

**Status: partial / cross-platform native acceptance passed.** PR #34
passed all four jobs in [CI #40104296753](https://github.com/godofecht/FlowStudio/actions/runs/40104296753)
on Ubuntu 24.04 and macOS 14. Each source/transport suite recorded 486
JavaScript passes, zero failures and two skips. Both native jobs compiled
the real Flow server, passed HTTP acceptance including a real untracked Git
fixture and intent/origin rejection, and packaged the executable. Merged as
[533887f](https://github.com/godofecht/FlowStudio/commit/533887fd69ec3da798687eefe93c3563fcdc9f00).
Physical-browser interaction remains unverified. Staging, commits, branches,
remote Git and project-folder selection remain missing. No RStudio parity
claim.


## 2026-10-25: native R CRAN package installation (implementation; acceptance pending)

The Flow-owned localhost backend now routes explicit package names through
`POST /api/packages/r/install` to a new `N` IPC operation in the persistent
Rscript kernel. Package names are validated in the browser and kernel;
arbitrary R expressions, URLs, repository overrides and filesystem paths are
rejected. New packages and required dependencies are downloaded from the
fixed HTTPS CRAN mirror into a FlowStudio-specific user library, not the
system library. The kernel adds that directory to `.libPaths()`, including
on restart. The existing load-installed operation remains separately
available in the package pane. Installation has a 180-second kernel deadline
and a 190-second browser deadline; failures/timeout do not imply success.
**CRAN installation executes third-party code with the local user's
permissions; the native server is loopback-only and is not a sandbox.**

Offline deterministic C/R IPC, Flow HTTP, browser transport and DOM regression
tests verify installed-package no-download behavior, rejected names,
session persistence, origin/intent gates, reset races and load/installation
UI separation. **Status: partial / independently accepted by Ubuntu 24.04 and macOS 14
CI #40174758087.** Both platforms compiled Flow 2.0.0, passed real
Rscript/C IPC and Flow HTTP acceptance, and installed a newly built minimal
R package from a local CRAN-style source repository using actual
`utils::install.packages()`. The installed package was executed before and
after a kernel reset. All four jobs succeeded; source/transport suites
recorded 545 JS passes, two skips and zero failures, plus 76 Python tests
(11 skips) per platform. [PR #50](https://github.com/godofecht/FlowStudio/pull/50)
merged as [6468094](https://github.com/godofecht/FlowStudio/commit/64680943968fb2c444f23a84b8400f41d0792555).
**Actual public CRAN downloads and physical-browser Pyodide/webR/native R
acceptance remain unverified.** Package updates/removal, dependency conflict
resolution and multi-user installation isolation remain unimplemented. No
hosted CI configuration was changed.
