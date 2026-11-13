# FlowStudio

[![CI](https://github.com/godofecht/FlowStudio/actions/workflows/ci.yml/badge.svg)](https://github.com/godofecht/FlowStudio/actions/workflows/ci.yml)

**Version:** `0.2.0-alpha.2` (developer preview; canonical value in [`VERSION`](VERSION)). See [release notes](RELEASE_NOTES.md), [release packages](https://github.com/godofecht/FlowStudio/releases), and the [hosted documentation site](https://godofecht.github.io/FlowStudio/). A preview package is published only after Linux and macOS CI gates qualify the same commit. The static site is published from `docs/` by `.github/workflows/pages.yml` only after CI passes on `main`.

A **Flow-first scientific IDE** intended to become a capable successor to RStudio. Flow is the application/session language; R and Python are supported as external language runtimes.

**Current status:** early, unverified developer preview. This is **not** RStudio feature parity. Exact coverage and acceptance criteria are in [docs/PARITY.md](docs/PARITY.md).

## Authenticated remote access (single-user preview)

Connect to a remote, already-running FlowStudio using the
[OpenSSH loopback tunnel](docs/REMOTE_SESSIONS.md):
`python3 scripts/ssh_tunnel.py user@host`. The remote Flow-owned server
continues listening only on 127.0.0.1:8751; SSH handles host/user
authentication. This is **not** HTTP authentication or multi-user isolation.
Do not expose the native code-execution service on a public interface.

## First executable slice

The initial implementation includes a native Flow server (src/main.flow), a small POSIX sockets/temp-file bridge (src/http_bridge.c), and a tabbed browser workspace (web/index.html) with a menu bar, one tab per open document (unsaved markers, close controls, Ctrl/⌘+Tab cycling), a resizable project sidebar, an environment panel and a console dock.

### Workbench UI development

The native workspace uses Monaco Editor and Lucide icons. Editor assets and its
worker are bundled locally in `web/ui/`; opening the IDE needs no editor CDN.
The Pages demo in `docs/app/` has a separate frontend.

To rebuild the checked-in UI assets:

```sh
npm ci
npm run build:ui
```

UI sources live in `frontend/`. Each open document has a Monaco model for undo
history and cursor state. Ctrl+K opens the command menu. Flow syntax coloring is lexical, and **Check Flow** runs the actual strict
Flow 2.x compiler check without executing the source. The primary Monaco
workspace shows compiler output and underlines source locations reported by
flowc. Diagnostics are invalidated after edits or document switches; this is
an explicit check, not a live language server or full compiler diagnostic index.

Run `npm test` for module tests and `python3 scripts/verify_native.py` for the real
Flow build and HTTP checks. With the native server running, `npm run test:ui`
exercises the Monaco workspace in headless Chromium. Install its browser with
`npx playwright install chromium`. Captures go in `build/ui/`.

The native build and HTTP checks pass locally. Browser verification remains
pending because the local browser processes fail before loading the workspace.

### Document outline

An **Outline** workspace tab lists the symbols of the active buffer for Flow
(functions, structs, enums, module bindings), Python (classes, methods,
functions, module constants with nesting depth) and R (functions, R6/S4 classes,
top-level bindings). Selecting a symbol moves the caret to its line and scrolls
it into view, and **Ctrl/⌘+Shift+O** (Edit ▸ Go to symbol) focuses the outline
directly. Extraction is a bounded, best-effort line scan in the browser: it does
not parse the language, skips lines over 400 characters, reports at most 400
symbols, and never sends buffer text to the server. The outline re-reads the
buffer 250 ms after typing stops and whenever the active document changes.

Press **F12** with the caret on a Flow, R or Python identifier to navigate to
its declaration in the active buffer. If absent, FlowStudio checks other
already-open same-language tabs and switches only when there is exactly one
match. The lookup is lexical and conservative, not semantic: imports,
members and local bindings are not resolved. If no open buffer defines the
identifier, it can also search the browser-granted project for one unique
unopened declaration; incomplete or ambiguous searches fail closed. Flow
outlines include compiler-shipped evolution models (`flow`), dynamics
systems (`dsys`), analysis horizons and PDE fields alongside ordinary
functions, structs and bindings. Navigation never executes source.

Run its tests with:

    node --test tests/ide_symbols.test.js tests/ide_outline.test.js tests/ide_definition.test.js

### Projects

One project is open at a time, and each keeps its own files and tabs. The
project switcher next to the FlowStudio name lists recent projects and holds
New project, Open folder and Close project.

- New project offers five templates: a Flow graphics app, a Flow program, a
  Flow, Python and R pipeline, a Python script and an R analysis. A project
  lives either in FlowStudio, in the browser's private file system (OPFS), or
  in a new folder inside a folder you pick on disk.
- Opening a project closes every tab of the previous one. Files with
  unsaved changes are listed first, with Save and switch, Discard or Cancel.
  The new project reopens the tabs it had last time, or its entry file.
- Examples open as their own local project, so the Explorer shows only that
  example's files and your edits to it are kept.
- The last project reopens on the next visit when the browser still allows
  access to it.

### Layout

The window has four regions: the sidebar (activity bar and views), the
editor, the side panel (Preview and Environment) and the console dock. The
layout manager (`web/ide_shell.js`) solves their sizes against the window:
the editor keeps at least 360 by 150 pixels, and when the window is too
narrow the side panel shrinks and then hides, then the sidebar does. Those
collapses are not saved, so widening the window brings the panes back.

Ctrl+B toggles the sidebar, Ctrl+Alt+B the side panel and Ctrl+J the dock;
the three buttons at the right of the top bar do the same. Clicking the
active activity-bar icon hides the sidebar. Splitters drag, take arrow keys,
and reset on double-click; dragging the dock below 60 pixels closes it. The
side panel stays closed until something needs it.

### Flow apps with graphics and hot reload

A Flow program that imports `stdlib/gfx.flow` runs in the Preview, in
the side panel. The server type checks it with the strict Flow emitter, builds
it with `flow wasm` into WebAssembly with the canvas backend
(`runtime/gfx_wasm.c` in the Flow repository), and the Preview runs the
build in a frame. Keyboard and mouse go to the program after you click the
canvas.

With Hot reload on, an edit rebuilds the app after a short pause, about one
second for the examples, and swaps the new build in once it has loaded. A
build that fails leaves the last good build running and lists the compiler
errors, each a link to its line. A reload restarts the program, so its state
starts fresh. The Graphics examples are a starter app and three games from
the Flow repository: Pong, Snake and Falling sand.

The first build on a machine also compiles the Flow runtime for WebAssembly,
which takes about ten seconds. The Preview needs Emscripten (`emcc`) on the
server's PATH. Builds live in a private folder under the system temp folder,
and the last four are kept. Code: `src/flow_app.c`, `web/app_host.html`,
`web/ide_app_preview.js`. Tests: `tests/ide_app_preview.test.js`,
`tests/test_flow_app.py`, `tests/native_projects_ui.mjs`.

### Workspace explorer

The native IDE at `http://127.0.0.1:8751/` has an activity bar on the left
with Explorer, Search, Outline, Plots, Data, Packages, Examples and Debug
views. The Explorer shows the open folder as a tree:

- Open folder asks the browser for read and write access to one folder.
  Recently opened folders are listed for one-click reopening, and the files
  that were open come back as tabs.
- New file and New folder take a name inline. A path such as
  `lib/helper.flow` creates the missing folders. Names are checked as you
  type.
- F2 or the context menu renames a file or folder. Delete asks before it
  removes anything. Dragging a file or folder onto another folder moves it.
  Open tabs follow a rename or move, and a tab with unsaved changes blocks
  the operation until it is saved or closed.
- Arrow keys, Home, End and Enter move through the tree. Typing the start of
  a name selects it. Shift+F10 opens the context menu, Ctrl+Shift+E focuses
  the Explorer, Ctrl+Shift+F opens Search, and Alt+F1 reveals the active file.
- Open files are marked in the tree, unsaved ones with an M. The breadcrumb
  above the editor shows the file's path, and each folder in it reveals that
  folder in the tree.

All file access goes through the browser's File System Access API on this
device, so the Explorer needs Chrome, Edge or another Chromium browser.
Nothing is uploaded to the server. Browsers do not yet offer an atomic folder
move for user folders, so a folder rename or move copies the folder, checks
every file, and then removes the original. Folders over 1,000 entries or
64 MB are refused.

The browser can open several source files at once as tabs, save them, choose a local project folder, lazily browse its source tree, create a source file in the project root, refresh the tree, search project files for literal text with exact match navigation, run the selected text or whole buffer as Flow, R or Python, and display captured stdout/stderr. Project operations use the browser File System Access API and are unavailable in browsers without folder-picker support. The native server retains separate Python and R interpreter processes between evaluations, with explicit reset controls. These are single-user localhost sessions, not restart-persistent or remotely isolated kernels.

### Editor find and replace

Use Ctrl/⌘+F to focus the in-buffer literal search, F3 / Shift+F3 for next/previous matches, and Ctrl/⌘+H to focus replacement. The source pane has Replace and Replace all controls, plus a case-sensitive option. Replacement text is literal (no regular-expression substitutions). Operations run locally in the browser; they never send the document to the execution API. The editor search is limited to 2 MiB and 10,000 matches; Replace all refuses to modify a truncated match set.

Run the additional pure-module tests with:

    node --test tests/editor_find.test.js

## Terminal console, packages, examples, debugger (native workspace)

**Terminal.** The bottom panel opens on a real terminal: xterm.js on a
pseudo-terminal running your login shell (`src/pty_session.c`). Several
terminals can run at once. Ctrl+P, Ctrl+K and quotes go to the shell.
The shell runs with your user's permissions behind the same localhost
intent gate as code execution. Shells left by a closed page are reclaimed.

The **Console** tab beside it holds the language consoles. The native workspace console is a full terminal, not a form: runtime tabs
(Flow, Python, R, plus explicit `+` sessions), a compact status row that only
reports states the server actually produced (unknown at start, running,
ready, failed, disconnected; Python/R say "shared interpreter" because they
really do share the persistent kernel), an integrated syntax-highlighted
prompt (`flow ❯` / `python ❯` / `r ❯`) that sits inline as the next line of
the transcript, history up/down recall bound to per-session drafts,
Transcript search (Ctrl+F inside the panel), clear visible output (Ctrl+L),
streaming timestamps and per-command durations, and an overflow menu holding
the opt-in device history flag, per-runtime history clearing and a two-step
destructive Python/R interpreter reset (Flow has no interpreter to reset and
the menu says so). Captured R/Python figures render inline as figures and
stay in the Plots panel. The session menu also downloads the selected
scrollback as a bounded, ANSI-stripped UTF-8 transcript (.txt), including
timestamps and figure placeholders but not image bytes or other session tabs.
This is an explicit local download, not automatic persistence; transcripts may
contain commands, output and secrets. Execution still goes through the Flow-owned
localhost routes with the same headers and busy-locks as before; nothing was
fabricated on top of the real kernels. The standalone `/console` page keeps
its simpler form-based layout for scripting and accessibility use.

**Flow MLIR backend.** The topbar has a **Backend** selector (next to
Runtime). Running a Flow buffer with Backend set to MLIR sends the source
to the real `flow` process with `--backend=mlir`; the default backend keeps
the documented C path. The server exposes this as
`POST /api/run/flow-mlir` and always returns the compiler's own stdout and
stderr. A Flow build without LLVM shows exactly that error. Verified live
against the real compiler on macOS arm64 (see below for both pipelines).

**Packages.** One list per runtime, Python and R, filtered as you type.
When the typed name is not installed, the first row offers to install it
(pip `--user`, pinned `name==version` allowed, or R from CRAN). R rows show
whether the package is attached and offer load, update and remove; Python
rows offer uninstall. Names are validated in the browser before any request.

**Data.** Lists the data frames in the R and Python sessions with their
shape, and the CSV and TSV files of the open folder. Either opens in a data
grid with sorting, filtering, paging and CSV export. Folder files are read
by the browser and never uploaded.

**Examples.** Search and category chips over 44 examples: getting started
in Flow, debugging walkthroughs for Flow, Python and R, multi-language
projects, the MLIR backend, and every MathFlow simulation in `examples/`
(generated into `web/examples_mathflow.js` at UI build time). Run opens the
files and runs the entry file; Debug opens them, places the example's
breakpoints and starts the debugger.

**Completion.** The Monaco workbench merges lexical Flow symbols (same
bounded scanner as the Pages editor), live Python/R session variable names
(refreshed on a short TTL after runs) keywords and snippets. Suggestions
are editable-text inserts only: no signature help, members or LSP.

Tests:

    node --test tests/terminal_render.test.js tests/workspace_console.test.js \
      tests/packages_panel.test.js tests/examples_gallery.test.js \
      tests/debug_panel.test.js tests/ide_completion_core.test.js \
      tests/workspace_panels_contract.test.js

Live acceptance run on macOS arm64 26 October 2026 with Flow 2.x + LLVM:
`/api/run/flow-mlir` produced the full FLOW → MLIR → LLVM → executable
pipeline and program output; the same program on `/api/run/flow` used the
FLOW → C path. `python3 scripts/verify_native.py` passes for the native
build and HTTP smoke; native R persistence was skipped locally because
`Rscript` is not installed on the verification machine.

## Independent Python/R/Flow console (browser workspace)

The `docs/app/` workspace has a **Console language** selector separate from the
source editor's language. Python submissions run in the same persistent Pyodide
worker as Python source cells, and R submissions run in the same persistent
webR session as R cells. Flow console submissions run full Flow programs through
the real native Flow-owned `/api/run/flow` endpoint **only** when the workspace
is served at `http://127.0.0.1:8751/app/`; GitHub Pages cannot compile Flow.
Flow is compiled afresh for each submission and has no persistent Flow REPL
variables. Switching console language preserves unsent drafts and bounded
100-entry command histories independently for each language. Runtime errors
preserve console input for correction; successful submissions clear it.
The Reset button targets the **source editor's** selected Python/R runtime;
Flow has no session to reset. No interpreter variables persist across reloads.

The console dispatch, history, drafts and pending-submission behavior have
Node regression tests. Physical-browser interaction with live Pyodide/webR
and native Flow execution remains unverified.

`node --test tests/browser_console_repl.test.js tests/browser_console_multilanguage.test.js tests/browser_console_repl_integration.test.js`

## Browser R named-list completion

In the `docs/app/` editor, select browser webR or native R and type a named
ordinary-list member access such as `analysis$model$sc`, then press
**Ctrl/⌘+Space**. Suggestions come from the selected **real R session's
existing environment inspection**, which is only inspected and never
executed.
Selecting `score` inserts only that member. A trailing `$` lists the
inspected names, including nested lists to the inspector's two-level limit.

The native R path still uses the Flow-owned loopback server. Only the first
twelve children per list and syntactically safe unquoted names are offered.
Class methods, data-frame columns, active bindings and uninspected members
are not guessed. The underlying R inspector may force lazy promises; do not
treat inspection as a sandbox. This is separate from the generated native
Monaco workbench, whose member-completion bundle is pending.

## Flow source-local symbol completion

The GitHub Pages editor and native-served `/app/` editor also support
**Ctrl+Space** for Flow source-local identifiers without executing code or
requiring a Python/R runtime. Completion scans bounded Flow source (256 KiB)
for functions, types, explicit imports, parameters and currently open lexical
`let` scopes. Comments and quoted strings are excluded, and results are
limited to 64 names. This is an editor convenience, **not** semantic completion:
it does not resolve imports transitively, infer types, offer members, or replace
the actual `flowc --strict` diagnostics. No Flow execution occurs on GitHub Pages.

`node --test tests/browser_flow_completion.test.js tests/browser_completion.test.js`
checks real Flow syntax fixtures and editor insertion.

## Flow language server

The native editor runs Flow's own language server, `flow lsp`, for Flow
buffers. The server starts it on the first request and keeps one copy
running (`src/lsp_bridge.c`). The browser reaches it through
`POST /api/lsp/request`, `/api/lsp/events` and `/api/lsp/status` on the
loopback port, with the usual `X-FlowStudio-Intent` header.

It gives Flow buffers completion, hover with the typechecked signature,
go to definition (F12, or Ctrl+click), references (Shift+F12), highlights,
rename (F2), Format document (Shift+Alt+F), quick fixes and problems as you
type. Each buffer is named `file:///flowstudio/<path in the project>`;
untitled buffers use their tab id.

Each request waits at most 3 seconds and then fails with 504, so a busy
server never holds up the rest of the IDE. If the server exits, the next
request starts a new one and the editor sends it the open buffers again.
While the server runs, the lexical Flow completion and the idle compiler
check step aside for Flow buffers. Check Flow still runs the strict
compiler on demand and skips lines the server already marks. Without a
`flow` binary the routes answer 503 and the editor keeps the lexical
helpers described below.

The server sees buffer text only. It does not read the project folder, so
definitions in other files are found only when they are open, and imports
of project files are not resolved. Positions assume one column per code
point, which can drift on lines with characters outside the Basic
Multilingual Plane.

Tests: `node --test tests/ide_flow_lsp.test.js`, the live
`python3 tests/test_lsp_bridge.py` and the Chromium acceptance
`node tests/native_lsp_ui.mjs`. The live tests honour `FLOWSTUDIO_URL`.

## Browser Python/R symbol completion

The GitHub Pages workspace and native-served `/app/` editor support
**Ctrl+Space** or **Complete Ctrl+Space** to list real Python and R symbol
names from the current interpreter session. Python names come from Pyodide's
globals and builtins; R names come from the active webR search path. Choose
a suggestion with keyboard Tab/Enter or click to insert it into the source
editor. The request does not evaluate the prefix or run user expressions.
Results are capped at 64 names and stale responses are ignored.

This is identifier-prefix completion only: member/attribute completion,
Flow completion, function signatures and LSP integration remain missing.
The legacy native `web/index.html` editor does not yet expose this UI.
Runtime acceptance in physical browsers is pending; see
`docs/PARITY.md`.

## Sequential Flow notebooks (native server)

The browser workspace at `http://127.0.0.1:8751/app/` can now run all
`# %%`-delimited **Flow** cells, alongside the existing Python and R notebook
execution. Select **Flow**, put a complete, independently executable Flow
program (including `function main() -> i32`) in each code cell, and choose
**Run all cells**. Cells are compiled and executed in order using the real
Flow-owned `/api/run/flow` route; execution stops at the first compiler or
runtime error. Markdown cells are displayed without execution. Bounded text
outputs can be recovered from browser storage after reload, but execution
state is not recovered.

Unlike persistent Python and R notebooks, **Flow cells run as independent
compiled programs**: declarations and variables do not persist between cells.
GitHub Pages cannot execute Flow because it cannot run the native compiler;
the hosted editor continues to execute Python/R through browser WebAssembly.
Flow notebooks are not yet supported by the Python/R-only Jupyter export or
HTML report exporter. Physical-browser end-to-end acceptance remains pending.

### Run notebook through the caret

In the browser workspace, **Run through here** executes every notebook code
cell from the beginning through the cell containing the caret, in source order,
through the existing Flow, Python and R execution backends. Markdown is
rendered but never evaluated; cells after the caret are not run. The existing
**Run from here** action executes the opposite range. The bounded notebook
runner validates the selected range before invoking any kernel, and stops on
the first error. Flow still requires the native localhost server. This is
not an RStudio-compatible kernel debugger or a guarantee of physical-browser
acceptance.

## Flow console session

The Flow console keeps a session, the way the R and Python consoles do.
Variables, functions, structs and imports from one entry are there in the
next. A bare expression shows its value.

    flow > let rate = 0.25
    flow > function grow(x: f64, r: f64) -> f64 { return x * (1.0 + r) }
    flow > grow(10.0, 0.5)
    15.0

In the editor, Ctrl+Enter sends the selection, or the statement under the
cursor, to the console and moves to the next statement, so a `.flow` file
without `main()` works as a script. A file with `main()` still runs as a
whole program. The Environment pane lists the session's Flow variables with
their types and values. Reset the session from the console menu.

Check Flow and Check Flow on idle check a script the way the session runs
it, so a `let` at the top level is not an error. In a script, the Flow
language server knows the session's variables, so hover and completion work
on names defined in earlier entries.

How it works: Flow compiles whole programs, so `src/flow_session.py`
rebuilds the session around each entry. Earlier declarations stay at file
scope and earlier variables come back as typed `let` bindings with their
values. The Flow checker names the type of each new variable, and a dump at
the end of the program reads the values back. Each entry runs through the
same bridged runner as Run, so the console can call `py()` and `r()`. An
entry that fails leaves the session as it was. Values the session cannot
rebuild (pointers, lists, maps, nested arrays, arrays over 4,096 items,
infinities) are listed as not kept, and later entries cannot use them. An
entry takes 1.5 to 2.5 seconds, mostly C compilation.

Tests: `tests/test_flow_session.py` (offline and live),
`tests/ide_flow_session.test.js` and the browser acceptance
`tests/native_flow_session_ui.mjs`.

## Flow, Python and R in one session

Flow programs, the Python session and the R session can call each other
while they run. Values cross directly between the live sessions, so no data
files are needed.

| From | Call | Gets back |
| --- | --- | --- |
| Python | `import flowstudio as fs`, then `fs.r("lm(...)")`, `fs.R.name`, `fs.R.name = value` | Python values; an R data.frame is a `fs.Frame` (`.rows()`, `.to_pandas()`) |
| Python | `fs.flow("kernel.flow")` or `fs.flow(source)` | what the Flow program printed |
| R | `py("...")`, `py$name`, `py$name <- value` | R values; a list of dicts or a Frame is a data.frame |
| R | `flow("kernel.flow")` | what the Flow program printed |
| Flow | `import flowstudio { py, r, py_num, r_num, py_int, r_int, fmt, fmt_int }` | the last value as text: one item per line, a data frame as CSV |

Each call evaluates in the same namespace as the editor and console, so
whatever one language creates, the others can read afterwards. A language
that is waiting on a call cannot be called back into; that request fails
with a clear error. A Flow program started by Python can still call back
into that Python session, because Python serves those calls itself. A Flow
program started from R runs without the bridge.

How it works: a call is a length-framed request on the caller's protocol
pipe. The C session transports relay it to the target kernel and pass the
reply back (`src/polyglot_bridge.c`). Flow programs get the channel on fds 3
and 4, and `src/flowstudio.flow` sits next to every run so the import
resolves. Python sends values to R as R source, R sends them back as JSON.

The Examples view's Polyglot category has five worked examples, generated
from `examples/polyglot/`:

- Python drives R: mtcars from R, grouped in Python, `lm()` in R.
- R drives Python: Python's `re` parses log lines, and R aggregates and plots them.
- Flow drives Python and R: a compiled SIR model queried from both sessions.
- Python runs a Flow kernel: `fs.flow()` with input read back through `py_int()`.
- Flow, Python and R pipeline: three files run in order with Run project.

Tests: `tests/test_polyglot_bridge.py` covers the conversions offline and
runs every polyglot example against the live server.

## Run and Debug

One debugger front end (`web/ide_debugger.js`) drives three real back ends:

| Language | Back end | Stepping |
| --- | --- | --- |
| Flow | LLDB on a `flow debug` build whose `#line` directives name the .flow file (`src/flow_debugger.py`) | into, over, out, pause, evaluate C expressions |
| Python | the persistent kernel's tracer (`src/python_debugger.py`) | into, over, out, run to cursor, pause on exceptions |
| R | top-level expression stepping in the persistent R session | over, run to cursor, evaluate R |

Click the gutter left of a line number, or press F9, to set a breakpoint.
Breakpoints take conditions (a C expression for Flow, a numeric comparison
such as `i>=3` for Python and R) and follow edits to the file. F5 starts or
continues, F10 steps over, F11 steps into, Shift+F11 steps out, Ctrl+F10
runs to the cursor and Shift+F5 stops. While paused, the editor marks the
line, a debug toolbar appears in the editor's path bar, and the Debug view shows variables,
watch expressions, the call stack and breakpoints. The Debug button beside
Run starts a session, which opens the Debug view and the Debug Console in the
dock. While paused, each line of the current function shows the values of the
variables it mentions, and hovering a name shows its value.
Breakpoint changes reach a running session at once.

Flow debugging needs LLDB with Python support: Xcode command line tools on
macOS, or `lldb` and its Python module on Linux (set
`FLOWSTUDIO_LLDB_PYTHON` to the Python that can import it). Debugging runs
real code with your permissions and is not safe for untrusted source.
GitHub Pages does not debug.

Tests: `tests/ide_debugger.test.js`, `tests/test_flow_debugger.py`,
`tests/test_python_debugger.py` and the browser acceptance
`tests/native_debugger_ui.mjs`.

## Native Git branches

The Git pane on the Flow-owned localhost server lists local branches, creates
a named branch at `HEAD`, switches to an existing local branch and offers
explicitly confirmed, non-forcing deletion of merged local branches. Git's
`branch -d` protects checked-out and unmerged branches; force deletion is
not exposed. Branch switching refuses tracked changes and non-ignored
untracked files; it never automatically stashes, commits, discards or
overwrites user work. Native Git commands use fixed argv, bounded timeouts
and disabled hooks. GitHub Pages has no access to the server working tree,
and a browser-picked project directory is not the Git target. Remote
tracking, merges and rebases are not implemented. Existing native Flow/HTTP
branch list/create/switch acceptance passed on Ubuntu and macOS in
[CI #40117614745](https://github.com/godofecht/FlowStudio/actions/runs/40117614745);
new deletion acceptance passed real Git/HTTP tests on Ubuntu and macOS in
[CI #40748505934](https://github.com/godofecht/FlowStudio/actions/runs/40748505934);
physical-browser interaction remains unverified. See [parity matrix](docs/PARITY.md).

`node --test tests/browser_git_native.test.js tests/browser_git_panel.test.js`
tests the browser-facing contract; `python3 scripts/verify_native.py`
builds the Flow server and exercises real Git operations over localhost
against an isolated temporary repository.

## Agent tools (MCP stdio server)

Agents (Claude Code, MCP-compatible clients) can drive this FlowStudio
install through a small stdio MCP server that proxies the native loopback
HTTP API with the same guarded `X-FlowStudio-Intent` requests. It supports
newline-delimited and LSP-style `Content-Length` framing, and answers:

- `flowstudio_run_code` compiles and runs Flow (default C path, or the
  real FLOW to MLIR to LLVM pipeline via the `mlir` language value),
  Python or R through the real server routes.
- `flowstudio_check_code` runs the strict Flow-to-C emit check without
  execution.
- `flowstudio_read_workspace_file` and `flowstudio_write_workspace_file`
  give bounded workspace file access.
- `flowstudio_flow_help` serves offline Flow 2.0.0 language reference
  entries.
- `flowstudio_health` is a server readiness probe.

Running tool calls execute unsandboxed local code, exactly as the native
server does; do not aim the server at untrusted input. The server prints
JSON-RPC to stdout only and binds nothing to a port.

    python3 mcp/flowstudio_mcp.py

Register it in an MCP client as command `python3` with arg
`mcp/flowstudio_mcp.py` (set `FLOWSTUDIO_URL` only if the native server
listens somewhere other than 127.0.0.1:8751). Contract tests that also
verify against a live server:

    python3 tests/mcp_server.test.py

## Build and launch

Requirements: [Flow 2.x](https://github.com/flooooooooooow/flow) installed as flow, a C11 compiler available as cc, POSIX macOS/Linux and a recent browser. Python 3 and Rscript are optional **runtime executables** for their respective execution modes.

From the repository root:

    sh scripts/build.sh
    ./build/flowstudio

Open http://127.0.0.1:8751 in a browser. Press **Ctrl/⌘+Enter** to execute selected text or the whole document, and **Ctrl/⌘+S** to save. On browsers supporting the File System Access API, saves write back to the selected file. Other browsers use a downloaded file fallback.

For a running server, test the HTTP API and installed language runtimes:

    python3 tests/http_smoke.py

For browser-logic tests without a running server (Node.js 20+):

    node --test tests/project_browser.test.js tests/project_search.test.js tests/workspace_browser.test.js

The build script performs a C syntax check, invokes Flow's documented C-generation compiler path and links the socket transport. These commands are provided for reproducibility; **no successful Flow compiler run is claimed** because the Flow toolchain is not installed in the authoring environment. Build and integration fixes are the highest-priority next milestone.

### Native transport regression tests

Stop any FlowStudio process already using port 8751, then run:

    python3 tests/transport_smoke.py

This builds the real POSIX transport with a small test-only router and exercises its request handling on loopback. It **does not require the Flow compiler** and **does not prove that FlowStudio itself builds**. The suite has 15 cases for Host/origin validation, request framing and size limits, and valid HTTP responses. On Linux x86-64 with GCC 14.2.0 and Python 3.13.5, all 15 passed on 15 October 2026.

### Project search

Open a folder, enter a literal query under **Find in project**, and select **Find all**. Matches appear with file paths and line/column locations. Selecting a result opens that file and highlights the match. Unsaved editor changes are never silently discarded. Search reads browser-granted local handles only; it does not send project contents to the Flow server. Search limits are documented in the parity matrix.

## Versioned native packages

After a successful native build and acceptance test (`python3 scripts/verify_native.py`), run `sh scripts/package.sh` to create a platform-specific `.tar.gz` in `dist/`. The archive has `run.sh`, the compiled executable, web assets, docs, licence, README and VERSION. Its runtime must be run from its own extracted root; `flow` 2.x is an external runtime dependency for Flow execution. Release automation publishes Linux x86-64 and macOS arm64 archives plus a source archive and SHA256 checksums only after both CI platforms pass on `main`.

## Experimental native R acceleration

An opt-in, guarded **FlowJIT** arithmetic-kernel prototype is available in the
persistent R session. `flowjit_compile(function(x) x * x + 1.0)` creates a
hotness-triggered GNU R C-toolchain specialization for plain double vectors,
with strict numeric inputs and a byte-compiled R fallback. Use
`flowjit_status()` to inspect real native invocations. This is **not** an
automatic replacement R compiler, nor does it presently emit Flow code.
See [scope, semantics and native acceptance](docs/FLOWJIT.md).

## Architecture

    browser (HTML/CSS/JS)
             |
    localhost HTTP / text execution API
             |
    src/main.flow (routing / execution / subprocess lifecycle)
             |
    std.process  +  native POSIX socket bridge
             |
       Flow / R / Python

Current API: GET /, GET /health, POST /api/run/flow, POST /api/run/flow-mlir, POST /api/check/flow, POST /api/run/r, POST /api/reset/r, POST /api/inspect/r, POST /api/run/python, POST /api/trace/python, POST /api/inspect/python, POST /api/demo/python-r and POST /api/reset/python. Flow runs on the C backend carry the language bridge described above. POST sends UTF-8 source text and requires an X-FlowStudio-Intent: run request header. Persistent Python and R sessions each have a 15-second evaluation timeout and explicit reset; Flow has a 60-second compile-and-run budget to accommodate cold compiler start. All processes have bounded, captured output. No shell command-string evaluation is used.

## Security and scope

**Code execution is not sandboxed.** Executed code has all the local permissions of the FlowStudio process; use trusted code only. The server binds to 127.0.0.1, rejects cross-origin browser execution and caps request size. Never expose this preview publicly or run it as root. A production remote service will require authenticated sessions and isolation before network exposure.

The native C shims handle OS-facing sockets, temporary files and framed interpreter IPC; Flow owns routing and session operations. Python and R evaluation are performed by their respective language runtimes.

## Licensing

This is a new independent codebase. It is not a translation of RStudio's AGPLv3 source. Flow itself has [separate licensing terms](https://github.com/flooooooooooow/flow/blob/main/LICENSE). No third-party RStudio source code is incorporated into this repository. The source and distributed preview are **all rights reserved**; see [LICENSE](LICENSE). External Flow, R and Python installations remain under their own terms.
