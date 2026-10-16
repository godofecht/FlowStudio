# FlowStudio plot history (partial, 2026-10-16)

Open `web/plots.html` directly in a browser. This is a working browser-local PNG plot importer with history selection, 25–400% zoom, download of the selected original, and clear. It does not require the native Flow server. Imported files remain local to the browser; no upload or execution API is involved.

The history retains at most 60 plots, each at most 16 MiB, and evicts older plots when the aggregate reaches 64 MiB. Object URLs are revoked on eviction, removal, clear, and page unload. PNG filename, MIME type (when supplied), and size are checked; this is not a binary PNG signature validator.

Validation on Linux x86-64 with Node.js 22.16.0: `node --test tests/plot_history.test.js` returned **6/6 passed**, and `node --check web/plot_history.js` plus `node --check web/plot_page.js` succeeded. These are model tests, not physical-browser tests.

**Not verified / missing:** Flow HTTP routing for this page, direct capture of plots produced by R/Flow/Python, SVG handling, plot-device lifecycle, physical-browser interaction, and macOS. This feature does not satisfy the RStudio plot-pane acceptance criterion.

Next: integrate a Flow-owned plot-output route and attach generated PNG history to the served workspace after native Flow compilation is verified.
