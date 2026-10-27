# Explicit Python ↔ R variable transfer (browser workspace)

The `docs/app/` workspace now has a **Copy variable** control in the Environment pane. Choose Python → R or R → Python, provide an existing source variable name and optionally a destination name, and execute the transfer. The destination receives a **copy**; the interpreters do not share references, processes or implicit state. Both interpreter sessions remain browser-local. Flow program execution remains owned by the native Flow backend; Flow values are not transferable through this feature.

## Supported values

The wire protocol is `{kind:"scalar"|"vector",type:"number"|"boolean"|"string",values:[...]}`. Python exports exact built-in scalar values or homogeneous built-in lists/tuples. R exports classless atomic numeric, integer, logical and character vectors. Python vectors become R atomic vectors; R vectors become Python lists. Python scalar values become length-one R atomic vectors. R length-one vectors remain lists in Python, and empty R vectors become empty Python lists. Python empty lists are rejected because their element type is unknown.

Values are bounded to 256 elements, 512 UTF-16 code units per string, 32 KiB encoded JSON, finite numbers with absolute value at most 2^53−1, and shared identifiers matching `[A-Za-z][A-Za-z0-9_]{0,79}`. NUL and invalid Unicode strings are rejected. Typed missing elements are now supported in vectors: R `NA_real_`, integer `NA`, logical `NA` and `NA_character_` export as JSON `null` while retaining the wire type (number/boolean/string). As before, R integer vectors map to wire `number` and return to R as doubles; integer storage is **not** preserved. Python homogeneous lists/tuples may contain `None`, which transfers as R's type-specific `NA`; R missing values import as Python `None`. The protocol uses an out-of-band `@NA@` R wire marker, distinct from the URL-encoded literal string `%40NA%40`. An all-missing R vector is transferable because R retains its atomic type; an all-`None` Python list cannot be typed and is rejected. Scalar `None` is rejected. Non-missing elements must still be homogeneous, finite and bounded. R `NaN`/`Inf` and Python `NaN`/`Inf` remain rejected. Python objects with user-defined iteration or representation, heterogeneous non-missing lists, nested containers, matrices, data frames, and classed R objects are not supported. R active bindings are rejected before reading, and active or locked target bindings are rejected before assignment. This is not a dataframe interchange, Arrow bridge, serializer for arbitrary objects or automatic synchronization.

The transfer controller checks the current session generation after each awaited operation, preventing an import if a reset occurs after export. Each kernel retains its existing serialized request queue. No code or variable data is uploaded to a FlowStudio server. A native Flow server serves the same explicitly allowlisted browser assets at `/app/`; GitHub Pages can use the browser transfer without native Flow compilation.

## Validation and limitations

`tests/browser_variable_transfer.test.js` covers protocol bounds, direction switching, stale-session prevention, generated Pyodide Python code through real CPython, R query construction and optional real Rscript execution, worker queue integration and Flow-owned static asset wiring. PR #29 passed CI #40088230707 on Ubuntu 24.04 and macOS 14. The native acceptance jobs ran all ten transfer tests without skips, including real CPython and Rscript execution of generated transfer queries, native Flow compilation and HTTP asset acceptance. Quality jobs passed 436 Node tests per platform. Physical-browser round trips with actual Pyodide/webR and an independently validated RStudio comparison remain outstanding.

For the next iteration, add real-browser acceptance of transfer and interpreter persistence, then introduce bounded typed tabular interchange with explicit missing-value semantics. Interactive debugging and authenticated remote sessions remain missing.


## Typed missing-value extension (26 October 2026)

The new regression suite `tests/browser_variable_transfer_missing.test.js` exercises the real worker-generated Python code under CPython, both webR transfer query directions, protocol validation, and actual Rscript when installed. The native verification harness now requires this test with real Rscript on both Linux and macOS; source-only Node runs may skip it. Independent [Linux/macOS CI #40422754617](https://github.com/godofecht/FlowStudio/actions/runs/40422754617) passed all four jobs, including five new transfer tests without skips on each native platform and real Rscript NA/NaN/Inf and literal-string assertions. The extension merged in [PR #91](https://github.com/godofecht/FlowStudio/pull/91). Real webR/Pyodide physical-browser round trips are still unverified, despite an opt-in acceptance scenario. The existing Flow-owned native server and hosted CI configuration are unchanged. This is typed vector interoperability, **not** tabular/data.frame interchange or RStudio parity.


## Bounded typed tables (27 October 2026; Linux/macOS CI verified)

The same Copy variable control additionally accepts a `{kind:"table",
columns:[{name,type,values},...]}` packet. The Python source must be an
exact built-in dictionary mapping valid column names to exact built-in
list/tuple columns; the R source must be an ordinary base `data.frame` with
default row names and classless atomic columns. The destination is a real
base R `data.frame` or Python dictionary of lists. Column names, ordering,
typed `NA` / `None` and literal `"@NA@"` values are preserved. R integer
columns are imported as doubles. Bounds: 1–16 columns, at most 128 rows,
equal column lengths, at most 512 characters per string and 32 KiB per packet.
Unsafe names, duplicate columns, custom row names, factors, pandas objects,
classed columns, NaN/Inf, mixed nonmissing types, and nested values are
rejected before assignment. Python cannot infer types from empty or all-None
columns, so exporting those dictionaries is unsupported; a zero-row typed
R table can be imported into Python but cannot be exported back without
explicit nonempty type evidence.

`tests/browser_variable_transfer_table.test.js` checks protocol rejection,
worker dispatch, generated CPython source, webR query construction and real
Rscript table round trips where installed. `scripts/verify_native.py
--require-r` requires the Rscript test in the native build gate. This is
**independently verified in Linux/macOS CI #40428898996** after
[PR #92](https://github.com/godofecht/FlowStudio/pull/92) merged.
Both native platforms passed six table regression tests without skips,
including actual CPython and Rscript round trips, and compiled and packaged
the pinned Flow 2.0.0 backend. Physical-browser Pyodide/webR table transfer
remains unverified; no full RStudio or pandas parity is claimed.


## NumPy Unicode vectors (27 October 2026; independent CI pending)

The optional NumPy destination now accepts nonempty R character vectors
without `NA_character_`, creating a real Unicode `numpy.ndarray` in the
persistent Python interpreter. The reverse direction accepts exact NumPy
Unicode arrays (dtype kind `U`) with a maximum declared width of 512 Unicode
code points per element, subject to the existing per-string UTF-16, total
packet and element bounds. It rejects bytes/object/structured dtypes,
subclasses, embedded NUL, invalid Unicode and missing character elements in
NumPy destination mode. Default Python list transfers still support typed
missing strings. See `tests/browser_variable_transfer_numpy.test.js` and
`tests/browser_variable_transfer_numpy_import.test.js`. This does not
preserve NumPy dtype width on the R side, nor verify a physical-browser
Pyodide/webR round trip or RStudio parity.
