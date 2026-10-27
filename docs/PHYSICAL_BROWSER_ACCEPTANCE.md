# Physical-browser acceptance (real interpreters)

FlowStudio's Node/V8 unit tests and native HTTP smoke do **not** establish that
the browser has successfully loaded real Pyodide or webR. This independent,
opt-in acceptance runner opens the checked-in IDE in an actual browser,
downloads the actual released interpreter distributions, executes source and
console commands, checks persistent state, exports and restores a Python
snapshot, verifies a source-file download, runs sequential Python notebook
cells, checks real matplotlib PNG plot history and webR canvas plotting, and resets the real R interpreter. There are no mocked workers, CDN
intercepts, or simulated interpreter responses.

From the repository root:

    python3 -m pip install playwright
    python3 -m playwright install chromium
    python3 tests/physical_browser_acceptance.py

The default test serves docs/app/ over a temporary loopback HTTP server.
The test requires network access to the pinned Pyodide and webR CDNs. A failed
download or unavailable runtime is a **failure**, never an implicit skip.
Expect the first Pyodide/webR download to take time. The --timeout 300 option
raises the per-operation deadline. Run --browser firefox or --browser webkit
after installing the corresponding Playwright browser. --python-only is an
explicitly narrower check, not full acceptance.

To include **real Flow execution**, start the compiled FlowStudio server from
the repository root, then run:

    python3 tests/physical_browser_acceptance.py --url http://127.0.0.1:8751/app/ --flow

The runner refuses non-loopback --url targets. With --flow it also
requires a real browser interaction with the native CPython conditional
debugger (pause on a live numeric local, continue, pause again, finish),
and then the opt-in raised-exception pause on a real caught CPython exception.
When --flow is requested without --python-only, the runner also selects
native Rscript in the real browser, executes persistent source and console
commands, runs sequential R notebook cells, verifies non-executing syntax
checks, inspects the real native R environment, resets it, and confirms the
separate webR workspace did not receive native variables. This new native R
browser scenario is **not yet independently executed**; merely adding it does
not establish a pass.

The native R scenario also checks real persistent data-frame pagination:
the first 200 rows are traversed in the browser's 50-row UI pages,
the Flow-owned endpoint fetches rows 201-251, the downloaded CSV contains
only those 51 loaded rows, and previous-page navigation returns to the
earlier slice. These are **new assertions, not a recorded browser pass**.
They require `--url http://127.0.0.1:8751/app/ --flow` and installed Rscript.

Native Flow execution and debugging are not tested against a fake backend
or GitHub Pages. Browser interpreter
execution and native Flow use separate runtime paths. The server is not
automatically built by this script; python3 scripts/verify_native.py remains
the native build and HTTP acceptance gate.

A full physical-browser pass requires the printed PASS records for real
Pyodide, webR, and (when requested) native Flow, with no browser exceptions.
Run and record evidence independently on macOS arm64 and Linux x86-64.
The companion test_physical_browser_harness.py only verifies the runner's
real static asset server and localhost safety contract; **its success does
not validate the browser runtimes**.

Status as of 2026-10-25: **runner implemented; physical-browser acceptance
not yet independently executed or verified**. Do not promote RStudio parity
on the basis of this harness or of mock/contract tests. Plot capture,
notebook file import, package installation, native debugging, remote
sessions, and broader parity still need separate browser acceptance.
