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

### Independent real-CLI and physical-browser acceptance

The optional tests use **actual installed** Quarto, R/knitr and Jupyter
engines, and a real Chromium download from the native Flow-owned server.
They do not substitute a renderer or kernel fixture. First start FlowStudio
on loopback, then run:

```sh
python3 -m unittest discover -s tests -p test_quarto_render.py
python3 tests/quarto_native_browser.py --url http://127.0.0.1:8751/app/ --language r
python3 tests/quarto_native_browser.py --url http://127.0.0.1:8751/app/ --language python
```

The unittest module skips real-CLI or engine-specific tests when dependencies
are absent. The browser acceptance program instead exits with a clear error
when Quarto or a required runtime is missing, and asserts that downloaded
HTML contains output actually produced by the selected language. The browser
test is **not** part of hosted CI and is not evidence of a pass until run.
Rendering now retains the original source/language and filename while an
asynchronous render is in progress, and reports when the editor changed
before the report finished.

### Server-side source validation

The native renderer also checks the submitted Quarto body at the server
boundary, rather than relying only on browser export restrictions. It accepts
R/Python fenced chunks with optional safe labels, and literal disabled R
chunks, while rejecting executable engines outside that set, unsupported
chunk options, #| directives, shortcodes, inline R/Python execution and
unterminated code fences. Unsupported source is rejected before the CLI
starts, including when submitted directly to the localhost HTTP endpoint.
This is source-format validation, **not an execution sandbox**: accepted
chunks still run with the user's local permissions. Physical-browser and
real-CLI acceptance are separate gates.
