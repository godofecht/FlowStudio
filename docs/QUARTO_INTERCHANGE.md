# Quarto HTML source interchange

FlowStudio can import and export a deliberately restricted Quarto .qmd
document from the browser workspace. **Open .qmd** converts supported
R/Python fenced code chunks into editable percent cells; **Export .qmd**
writes Quarto source locally. Neither operation executes code or invokes
Quarto. The native Flow compiler remains the application backend.

The codec accepts optional YAML with literal scalar title, author and date,
and only scalar format: html. Export emits that format. It uses the existing
strict R Markdown parser to preserve R/Python chunk labels, Markdown text and
UTF-8 content. Disabled eval=FALSE R Markdown chunks remain inert Markdown.
Flow cells cannot be represented as executable Quarto chunks and are rejected;
use .fsnb or the offline HTML report for Flow/mixed-language notebooks.

Quarto-specific #| chunk options, executable inline engine expressions,
shortcodes, unsupported engines, arbitrary knitr options, executable YAML,
other output formats and unsupported metadata are **rejected**, not silently
discarded. The same source, cell and output-size limits as R Markdown apply.
The imported YAML is stored as inert Markdown with the equivalent R Markdown
output: html_document key so that both .Rmd and .qmd export can use the
same safe internal representation.

This is **source interchange only**, not Quarto rendering, Pandoc execution,
kernel-state restoration, full Quarto syntax support, or RStudio feature
parity. Quarto must be installed separately to render exported documents,
with suitable R/Python engines and packages.

Validation: node --test tests/browser_notebook_quarto.test.js. Physical
Chromium acceptance with live webR/Pyodide and external Quarto rendering
has not been established.
