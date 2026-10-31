# Asynchronous notebook import isolation

The production browser controller `docs/app/notebook_io.js` applies the same
selection and editor-revision guards to Jupyter `.ipynb`, portable `.fsnb`,
R Markdown `.Rmd` and Quarto `.qmd` imports.

If two file reads finish out of order, only the latest selected document can
be applied. If source or language changes while a file is being read, the
pending import is cancelled before the editor is modified. A second import
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
intervening editor edits, cross-format selection ordering, malformed size
metadata and an asynchronous import-application lock. The existing native
acceptance exercises real Flow compilation, production HTTP, R/C FlowJIT and
Ubuntu Chromium. These new races are controller tests, **not** a claim of
physical-browser race verification.

Resource ceilings: 4 MiB per imported document, checked against actual
UTF-8 bytes; existing parser-specific cell/source limits remain enforced.
No hosted CI workflow configuration was changed. Independent macOS physical
browser and local native Flow/R acceptance remain unexecuted.
