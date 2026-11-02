# Cross-kernel figure history and bounded capture responses

The native FlowStudio Plots tab is one history for both persistent base R and
CPython kernels. A successful R capture followed by a successful Python capture
must retain both figures in capture order. A failed or empty capture must not
clear either figure.

## Reproduce

From the repository root, with Node 22 or newer:

```sh
node --test tests/plot_figures.test.js tests/browser_plot_figures_budget.test.js
```

The deterministic seed-20261102 fixture generates twelve distinct, bounded
PNG figure records. All twelve must be accepted and rendered. Adding a
thirteenth record must reject the entire batch without mutating history.
The same test exercises a real `web/plot_figures.js` import, not a copy of the
validation implementation.

The production `/api/plot/r` and `/api/plot/python` POST routes are used by
`FlowStudioPlotFigures.show` with `X-FlowStudio-Intent: run`. The test
substitutes deterministic HTTP responses at the fetch boundary, while the
existing native HTTP and physical Chromium CI suites continue to exercise
the actual Flow-owned server and browser.

## Resource and failure contract

A response has a maximum of 20 MiB of encoded bytes, allowing twelve maximum
size PNG records plus JSON overhead. An excessive `Content-Length` is rejected
before reading. A streamed body is decoded incrementally as strict UTF-8,
cancelled on overflow, and rejected on malformed UTF-8. Legacy fetch mocks
without a body stream are bounded after `text()`; this fallback cannot
prevent an oversized in-memory allocation by the mock itself.

A batch may contain at most twelve figures, with the existing individual
60,000-character SVG, 120,000-character PDF-hex and 1,398,104-character
PNG-base64 limits. Rejected batches do not overwrite existing history.

## Verification status

The standalone regression tests are checked in. Linux/macOS production CI
results must be recorded after the exact PR head completes. No assertion
about independently tested macOS physical Chromium or full RStudio parity
follows from these tests. The mathematical Flow compiler and PDE execution
are unchanged.
