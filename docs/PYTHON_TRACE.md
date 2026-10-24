# Native Python execution trace (experimental)

FlowStudio's native Flow-owned server supports bounded **real CPython line
tracing** in the same persistent Python process used for normal native
execution. This is not an interactive debugger, does not pause on breakpoints,
and is not available on static GitHub Pages.

From the repository root with Flow 2.0.0, a C compiler and Python 3:

```sh
sh scripts/build.sh
./build/flowstudio
```

Open the native browser workspace at `http://127.0.0.1:8751/app/`,
select Python, enter source and click **Trace Python (native)**. The result
shows actual executed source lines, functions, elapsed timestamps and bounded
local variable metadata. Selecting a line jumps to the corresponding source
offset unless the editor source has changed.

The underlying Flow route is:

```sh
curl -fsS -X POST http://127.0.0.1:8751/api/trace/python \
  -H 'X-FlowStudio-Intent: run' \
  --data-binary $'x = 40\nprint(x + 2)'
```

The JSON response has `ok`, `output`, `events` and `truncated`.
Each event contains `line`, `function`, `elapsed_ms` and `locals`.
The trace is limited to 256 line events and 16 locals per event. Scalar
previews are emitted only for exact Python built-in `int`, `float`, `bool`
and `str` types; arbitrary user `__repr__` methods are not invoked.
Events are trimmed further if the encoded response approaches the 128 KiB
kernel protocol limit.

**Important:** tracing executes the code, including side effects, using the
same native persistent Python namespace. Browser Pyodide and native CPython
have separate namespaces. There is no sandbox or remote-user isolation.
Tracing uses `sys.settrace` and restores the prior trace hook on completion.
Elapsed values are observational timestamps, not precise per-line CPU
profiling. Source that changes tracing itself may affect instrumentation.
The native request retains the existing 15-second process-group timeout.

Acceptance: `python3 -m unittest tests/test_python_trace.py`,
`node --test tests/python_trace_view.test.js`, the native C IPC harness,
and `python3 scripts/verify_native.py --require-r` with a real Flow build.
Cross-platform CI and physical-browser acceptance are separate gates.

**Parity status:** diagnostics/profiling **partial**. Interactive
breakpoints, stepping, call-stack controls, Flow/R debugging, and remote
sessions remain **missing**.
