# Asynchronous notebook import isolation

The production browser controller `docs/app/notebook_io.js` applies the same
selection and editor-revision guards to Jupyter `.ipynb`, portable `.fsnb`,
R Markdown `.Rmd` and Quarto `.qmd` imports.

If two file reads finish out of order, only the latest selected document can
be applied. If source or language changes while a file is being read, the
pending import is cancelled before the editor is modified. A switch to a
different active editor document or interpreter session also cancels the read,
even when the replacement buffer has identical source text and language. A second import
cannot begin applying while an earlier `onImported` update is outstanding.
The controller checks actual UTF-8 bytes after reading, not only the file's
reported size. Unsupported formats and invalid documents continue to fail
closed through their production decoders; no imported source is executed.

Reproduce the deterministic race and negative cases:

```sh
node --test tests/browser_notebook_import_races.test.js
npm test
python3 scripts/verify_native.py
```

The new Node regressions exercise all four real decoders, delayed reads,
intervening editor edits, identical-content document switches with a successful
subsequent import, cross-format selection ordering, malformed size
metadata and an asynchronous import-application lock. The existing native
acceptance exercises real Flow compilation, production HTTP, R/C FlowJIT and
Ubuntu Chromium. The native Chromium acceptance now also delays a real browser File.text()
read to verify latest-selection ordering and editor-change cancellation in
the served production notebook UI. That physical-browser gate requires CI
qualification; it does not mock the interpreter or HTTP responses. The new
active-document switch regressions run in the real-decoder Node controller
suite; a separate physical-browser tab-switch race has not been executed.

Resource ceilings: 4 MiB per imported document, checked against actual
UTF-8 bytes; existing parser-specific cell/source limits remain enforced.
No hosted CI workflow configuration was changed. Independent macOS physical
browser and local native Flow/R acceptance remain unexecuted.
