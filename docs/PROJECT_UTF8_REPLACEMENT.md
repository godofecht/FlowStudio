# UTF-8-safe polyglot project search and replacement

The browser File System Access project explorer accepts Flow, R, Python and
other supported source files. Project search is read-only; replacement uses
preview, preflight, verified writes and best-effort compensation. Both
`web/project.js` and the shipped `docs/app/project.js` enforce the same
limits.

## Byte-level acceptance

Source files are bounded by **1,048,576 UTF-8 bytes** for literal search and
replacement, or **131,072 UTF-8 bytes** for regular-expression operations.
Limits apply to decoded text even when a file's reported `size` understates
its actual content. Malformed UTF-8 and unpaired UTF-16 surrogates are
rejected, and search accounts for oversized and unsafe files separately.
An incomplete search cannot become a replacement preview.

The replacement preview rejects output containing binary NUL, output larger
than its per-file search limit, or a total pre/post-image budget greater than
8 MiB of UTF-8 data. This check occurs **before any writable handle is opened**.
The editor's own in-buffer limits remain independent.

## Reproduce

```sh
node --test tests/project_search.test.js tests/project_replace.test.js
npm test
```

The deterministic regression suite exercises both the native and GitHub Pages
project explorer implementations, exact multibyte file boundaries, inaccurate
file metadata, invalid byte sequences, unpaired surrogates, overflow after
Unicode replacement, NUL rejection and 12 nested multilingual Flow/R/Python
files with 96 replacements and exact recovery. Existing CI also exercises
native Flow compilation, production HTTP and Ubuntu Chromium; these new
project tests are not themselves a new physical-browser end-to-end test.

This is a bounded browser-local project reliability improvement. It does not
establish remote collaboration, general PDE compilation or RStudio parity.
