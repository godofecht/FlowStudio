## Optional Python → R matrix destination

In the browser Copy variable panel, select **Python → R** and **Python homogeneous
table or 2D NumPy ndarray → R matrix**. The destination is a real base R
matrix rather than the default data.frame. Only homogeneous typed tables with
1–128 rows and 1–16 columns are eligible; all existing packet and string
limits apply. Values are inserted column-major to preserve Python 2D ndarray
row/column order. Numeric missing cells become `NA_real_`; missing logical
and character cells retain their R missing-value types. Mixed-type and empty
tables fail without replacing the destination. The operation intentionally
loses column labels, dtype widths and other Python/NumPy metadata, and cannot
guarantee that a table came from NumPy rather than pandas or a dictionary.

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


## NumPy Unicode vectors (27 October 2026; Linux/macOS CI passed)

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
Pyodide/webR round trip or RStudio parity. [PR #104](https://github.com/godofecht/FlowStudio/pull/104)
passed all four Linux/macOS jobs in [CI #40515203015](https://github.com/godofecht/FlowStudio/actions/runs/40515203015).


## NumPy 2D matrices → R data.frames (27 October 2026; acceptance pending)

Python → R **Copy variable** accepts exact two-dimensional NumPy ndarrays with
approved native numeric, boolean and Unicode dtypes. It converts each column
to the existing bounded typed-table protocol, naming columns `V1`, `V2`,
… `V16` in their original order. The existing webR importer constructs a
base R `data.frame`; no new R evaluation path is added. Supported matrices
have 1–128 rows and 1–16 columns, with the same 32-KiB payload limit.
Floating NaN is represented as typed R `NA` only when a column has at
least one nonmissing element. All-missing columns are rejected rather than
assigned a guessed type. Object, complex, bytes, structured and subclassed
arrays, unsafe integers, invalid Unicode, empty dimensions and 3D+ arrays
are rejected. One-dimensional arrays retain their vector transfer behavior.

This is a **lossy matrix-to-data.frame conversion**, not preservation of
R matrix identity, NumPy shape/dtype metadata, row names or integer storage.
Real CPython/NumPy tests and Rscript acceptance when available are included
in `tests/browser_variable_transfer_numpy_matrix.test.js`. Independent CI
and physical-browser Pyodide/webR acceptance have not yet been verified.

## 2026-10-27: opt-in homogeneous R data.frame → NumPy 2D ndarray (CI passed)

The browser Copy variable operation now accepts an ordinary R data.frame as
an explicit NumPy destination only when every column has the same wire type.
It constructs a real two-dimensional ndarray in the persistent Pyodide worker,
preserving row/column order and typed numeric missing cells as NaN. Boolean
and Unicode tables require nonmissing cells; mixed-type tables, empty rows,
malformed packets and simultaneous pandas/NumPy selection are rejected before
Python mutation. Existing R vector → NumPy and default table → dictionary
transfers are unchanged. R column names, integer storage, factors and custom
row names are not preserved in the ndarray. Existing table protocol limits
(1–16 columns, 1–128 rows, 32 KiB) apply.

**Status: partial / four Linux/macOS CI jobs passed in [PR #106](https://github.com/godofecht/FlowStudio/pull/106) ([CI #40534281335](https://github.com/godofecht/FlowStudio/actions/runs/40534281335)); physical Chromium Pyodide/webR execution pending.** Tests cover exact NumPy shape/dtype, Unicode, missing numeric
cells, invalid tables and destination preservation on constructor failure.
This is not general R matrix identity interchange or RStudio parity.


## 2026-10-27: plain R matrix → NumPy ndarray (independent validation pending)

The browser-local R → Python **Copy variable** operation now accepts exact
unlabelled, unclassed, two-dimensional base R matrices of numeric, integer,
logical or character storage. The existing webR exporter converts the matrix
into a bounded typed table with V1–V16 column names, and the existing NumPy
worker constructs a real two-dimensional ndarray in the persistent Python
session when the NumPy destination is selected. Matrix rows and columns retain
their order (R is column-major). Ordinary default dictionary transfers remain
available. Numeric missing values become NaN; logical and character matrices
with missing cells are rejected in NumPy mode.

The exporter rejects dimnames, custom attributes, classed matrices, zero-sized
matrices, dimensions beyond 128 rows or 16 columns, unsafe numbers and invalid
strings. The 32-KiB wire limit remains. This conversion does **not** preserve
R matrix identity in the wire protocol, original column names, integer storage
width or other R attributes. It is not an R matrix round-trip: Python → R
still imports the same typed table as an R data.frame.

`tests/browser_variable_transfer_r_matrix.test.js` checks the webR query,
worker handoff, real CPython/NumPy construction, Unicode, and actual Rscript
matrix acceptance/rejection where installed. Native verification now requires
that test with Rscript. **Status: partial; Linux/macOS CI and physical
Chromium Pyodide/webR execution not yet verified.**
