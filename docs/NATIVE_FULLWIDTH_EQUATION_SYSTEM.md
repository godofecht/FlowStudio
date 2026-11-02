# Native fullwidth equation-system separators (2026-11-02)

The bounded executable Flow 2.0 equation-system parser accepts U+FF1B FULLWIDTH
SEMICOLON (`；`) as a top-level separator alongside ASCII `;` and line
endings. It consumes all three UTF-8 bytes, rebases every child equation's
source span to the original input, and rejects nested separators, empty
equations, trailing separators, and mismatched physical dimensions. Comments
do not turn embedded separators or unmatched parentheses into syntax.

The checked-in `src/math_equation_system_smoke.flow` adds 13 exit-code
assertions (107–119) covering three differently dimensioned equations,
mixed fullwidth grouping, comments, multiline input, numerical residuals,
original byte offsets, and fail-closed negative cases. Its executable
`main()` is compiled and run by the existing Linux/macOS native Flow gate.

The existing `tests/http_smoke.py` concatenates the **same checked-in
modules and smoke program** for anonymous compilation through the production
`/api/check/flow` and `/api/run/flow` endpoints. It verifies the Unicode
fixture is present and requires an HTTP 200 plus the native success marker;
the existing malformed-compiler HTTP 422 control remains mandatory.
The production 128 KiB UTF-8 source limit is not relaxed.

Reproduce on a machine with the Flow toolchain:

```sh
flow run src/math_equation_system_smoke.flow
python3 scripts/verify_native.py --require-r
npm test
python3 -m unittest discover -s tests -p 'test_*.py'
```

Independent source-bundle reconstruction before CI measured 128,544 UTF-8
bytes, leaving 2,528 bytes below the 131,072-byte transport limit. This is
a **source-size check**, not evidence of native compilation or HTTP success.
Exact-head Linux/macOS CI and post-merge main must be independently checked
before describing the new syntax as verified.

This is bounded scalar-equation punctuation, not upstream grammar
integration, tensor ASTs, native Navier–Stokes, general multidimensional
`field` lowering, or complete RStudio parity.
