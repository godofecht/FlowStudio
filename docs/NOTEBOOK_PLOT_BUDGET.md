# Bounded aggregate notebook PNG snapshots

The production mixed-language notebook runner (`docs/app/notebook_runner.js`)
now enforces an **8 MiB cumulative retained PNG payload limit** per notebook
execution, in addition to the existing 32-plot aggregate and eight-plot
per-cell ceilings. A retained PNG may not exceed 1,398,104 base64 characters.
Untrusted auxiliary worker fields are discarded before notebook results enter
the DOM, export or recovery paths. The existing 32-bitmap ceiling is independent.

Reproduce the deterministic boundary regressions:

```sh
node --test tests/browser_notebook_runner.test.js
npm test
```

The checked-in tests exercise twelve sequential percent-code cells, eight
1 MiB PNG snapshots retained at the exact 8 MiB ceiling, later snapshots
dropped without stopping kernel execution, malformed and oversized PNG
rejection, auxiliary-field removal, UTF-8 text independence and retained
bitmap independence. The real notebook controller and source-cell parser are
used, not a replacement interpreter. Actual Flow/Python/R kernel, production
HTTP and physical Chromium qualification remain separately gated by CI.

This limits browser-retained output, not the size of the interpreter's own
working memory. It does not establish full RStudio parity.
