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

Leading Quarto `#| label: safe-name` and literal `#| eval: true` options
are imported as executable labeled R/Python cells. Literal `#| eval: false`
is accepted for R chunks only: it becomes inert Markdown containing a
knitr `eval=FALSE` chunk and remains disabled on export. Labels are emitted
in the chunk fence rather than as `#|` directives.

Other `#|` options, late/duplicate directives, disabled Python chunks,
inline engine expressions, shortcodes, unsupported engines, arbitrary knitr
options, executable YAML, other output formats and unsupported metadata are
**rejected**, not silently discarded. The same source, cell and output-size limits as R Markdown apply.
The imported YAML is stored as inert Markdown with the equivalent R Markdown
output: html_document key so that both .Rmd and .qmd export can use the
same safe internal representation.

This is **source interchange only**, not Quarto rendering, Pandoc execution,
kernel-state restoration, full Quarto syntax support, or RStudio feature
parity. Quarto must be installed separately to render exported documents,
with suitable R/Python engines and packages.

Validation: `node --test tests/browser_notebook_quarto.test.js` and, with
the native server running, `node tests/quarto_ui.mjs` in real Chromium.
The native Chromium Quarto import/export check and all six Linux/macOS
CI jobs passed in [CI #40611478697](https://github.com/godofecht/FlowStudio/actions/runs/40611478697).
These tests do not invoke Quarto. External Quarto rendering and live
Pyodide/webR physical-browser acceptance remain separate milestones.


## Native render (opt-in, not Pages)

When FlowStudio is served by the native Flow backend on localhost:8751, the
**Render .qmd (native)…** control exports the current restricted R/Python
notebook to Quarto source, asks for explicit code-execution consent, invokes
the installed Quarto CLI and downloads a standalone HTML report. This is
**real Quarto execution**, not the inert offline Markdown report. The native
server's POST /api/render/quarto endpoint is origin/intent gated; Pages cannot
call it. Quarto, R/knitr and/or Python/Jupyter engines must be installed
separately. The helper uses a temporary working directory, fixed arguments,
--execute, --no-cache, a 45-second CLI deadline, and a 2 MiB output cap.
It supports only restricted HTML .qmd interchange; local files outside the
temporary directory are not copied in. Relative image/file dependencies
may fail. Code chunks run with the local user's permissions; **do not render
untrusted notebooks**. Downloaded HTML may contain active content.

Verification: python3 -m unittest discover -s tests -p test_quarto_render.py,
node --test tests/browser_quarto_render_wiring.test.js, and the real native
HTTP smoke suite. The real-Quarto test is skipped if Quarto is not installed.
Physical browser, R/Python chunk execution, and cross-platform CI must be
confirmed separately before claiming tested runtime parity.
