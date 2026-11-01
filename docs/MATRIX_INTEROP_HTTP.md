# Production Flow/R/Python matrix interoperability

The native Flow 2.0 compiler runs `src/math_determinant_smoke.flow`
through `tests/http_determinant_smoke.py`, including 43 exact-integer
determinant assertions generated from seed `20261101`. The same 43
2×2, 3×3 and 4×4 matrices now run through the persistent R HTTP kernel
using base-R `det`, `qr` and `solve`, with all nonsingular solutions
checked by a second exact-rational Cramer's-rule oracle executed through
the actual persistent Python HTTP kernel.

The fixtures include transposition, row swaps, row additions and one
singular matrix per size. R emits one bounded, indexed result frame per
matrix. Each result's determinant, rank and all solution coordinates
are independently checked; the Python kernel must reject a deliberately
corrupted solution with HTTP 422 and subsequently recover. The R kernel
must retain the final count after the Python rejection. The generated
R/Python sources are bounded to 128 KiB, and the response and Python
payload are bounded to 24 KiB. No CRAN packages, random network access
or mocked runtime are required.

Run the local source/oracle checks with:

```sh
python3 -m unittest discover -s tests -p test_matrix_interop_source.py -v
```

Run full native compilation and real localhost HTTP acceptance with
Flow, Rscript, Python, Node and the repository build dependencies
installed:

```sh
python3 scripts/verify_native.py --require-r
```

The full gate starts the production server and invokes
`tests/http_smoke.py`, which calls
`tests/http_matrix_interop.py` inside the real R acceptance branch,
and separately runs the production native determinant HTTP test.
Linux/macOS CI must qualify the complete path before merging.

This does not claim generalized compiler-generated multidimensional
`field` lowering, a matrix/tensor AST, native matrix inversion in Flow,
or complete RStudio parity.
