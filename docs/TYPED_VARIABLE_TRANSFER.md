# Explicit Python ↔ R variable transfer (browser workspace)

The `docs/app/` workspace now has a **Copy variable** control in the Environment pane. Choose Python → R or R → Python, provide an existing source variable name and optionally a destination name, and execute the transfer. The destination receives a **copy**; the interpreters do not share references, processes or implicit state. Both interpreter sessions remain browser-local. Flow program execution remains owned by the native Flow backend; Flow values are not transferable through this feature.

## Supported values

The wire protocol is `{kind:"scalar"|"vector",type:"number"|"boolean"|"string",values:[...]}`. Python exports exact built-in scalar values or homogeneous built-in lists/tuples. R exports classless atomic numeric, integer, logical and character vectors. Python vectors become R atomic vectors; R vectors become Python lists. Python scalar values become length-one R atomic vectors. R length-one vectors remain lists in Python, and empty R vectors become empty Python lists. Python empty lists are rejected because their element type is unknown.

Values are bounded to 256 elements, 512 UTF-16 code units per string, 32 KiB encoded JSON, finite numbers with absolute value at most 2^53−1, and shared identifiers matching `[A-Za-z][A-Za-z0-9_]{0,79}`. NUL and invalid Unicode strings are rejected. Missing R values, non-finite numbers, Python objects with user-defined iteration or representation, heterogeneous lists, nested containers, matrices, data frames, and classed R objects are not supported. R active bindings are rejected before reading, and active or locked target bindings are rejected before assignment. This is not a dataframe interchange, Arrow bridge, serializer for arbitrary objects or automatic synchronization.

The transfer controller checks the current session generation after each awaited operation, preventing an import if a reset occurs after export. Each kernel retains its existing serialized request queue. No code or variable data is uploaded to a FlowStudio server. A native Flow server serves the same explicitly allowlisted browser assets at `/app/`; GitHub Pages can use the browser transfer without native Flow compilation.

## Validation and limitations

`tests/browser_variable_transfer.test.js` covers protocol bounds, direction switching, stale-session prevention, generated Pyodide Python code through real CPython, R query construction and optional real Rscript execution, worker queue integration and Flow-owned static asset wiring. Direct V8 syntax and mocked protocol checks are useful, but do not establish real Pyodide/webR browser execution. Full cross-platform CI, physical-browser round trips with actual webR/Pyodide, and an independently validated RStudio comparison remain outstanding until those runs succeed.

For the next iteration, add real-browser acceptance of transfer and interpreter persistence, then introduce typed tabular interchange with explicit missing-value semantics. Interactive debugging and authenticated remote sessions remain missing.
