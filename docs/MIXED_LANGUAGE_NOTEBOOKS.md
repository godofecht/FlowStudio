# Mixed-language percent-cell notebooks

The FlowStudio browser workspace executes Python and R cells in the same
ordered source document, with each language using its **existing persistent**
interpreter (Pyodide and webR). The Flow-owned native server is additionally
available for explicitly tagged Flow cells when the workspace is opened at
`http://127.0.0.1:8751/app/`.

Select **Python** in the workspace language menu, paste the following, and
click **Run all cells**:

```python
# %% [python]
x = sum([1, 2, 3, 4, 5])
print(x)

# %% [r]
x <- sqrt(15)
cat(x, "\\n")

# %% [python]
print(x * 2)
```

Python's `x` remains `15` in the third cell; R's independent `x` is
`sqrt(15)`. The run-all controller dispatches each cell to the indicated
runtime in source order and stops on the first failure. Untagged `# %%`
cells use the language selected in the toolbar. `# %% [markdown]` cells
display text without execution. **Run cell** respects explicit tags too.

A native-only Flow cell can be inserted with:

```flow
# %% [flow]
function main() -> i32 {
    println("Hello from native Flow")
    return 0
}
```

The notebook preflights every executable cell before dispatch; any Flow cell
on GitHub Pages is rejected **before** executing earlier Python/R cells.
Flow runs through the existing native server and is independently compiled
per cell; Flow variables are not shared between Flow cells.

## Interoperability boundaries

This implements *mixed-language execution*, not transparent cross-language
object sharing. Python and R have independent namespaces. To transfer data,
use a deliberately chosen serialization format in a future implementation;
do not assume a Python variable is available to R or vice versa.

GitHub Pages runs Pyodide and webR WebAssembly runtimes in the browser, but
does **not** compile or execute Flow. The native server remains Flow-owned.
The normal Jupyter `.ipynb` exporter only supports a single language kernel;
it now **rejects** incompatible mixed-language cells rather than silently
exporting incorrect kernel metadata. Save the original percent-cell source
to preserve mixed-language execution instructions.

Tests: `node --test tests/browser_mixed_language_notebook.test.js`.
The suite covers ordered dispatch, language-tag parsing, parser parity,
native Flow preflight, errors, output labeling, and lossy export prevention.
These are deterministic JS/controller tests. They are not a physical-browser
verification of the actual downloaded Pyodide/webR runtimes. The repository
cross-platform CI supplies additional native build/HTTP acceptance.

## Bounded notebook execution

Run-all and selected-range execution preflight the actual UTF-8 source (2 MiB),
reject malformed Unicode, cap the selected range at 512 total code/markdown
cells and retain the existing 128 executable-cell and 64 KiB per-code-cell
limits. The 512-cell limit applies to the **selected range** so a single cell
can still be executed from a larger source. Markdown output is bounded to
16 KiB at complete Unicode code-point boundaries; detached renderers return
a structured failure rather than leaving a rejected notebook promise.
These checks happen before interpreter side effects. The checked-in
`tests/browser_notebook_preflight.test.js` exercises exact boundaries,
large multibyte sources, malformed Unicode, mixed-language dispatch and
renderer failure against the production notebook runner. Native HTTP and
physical-browser acceptance remain separate gates; controller tests alone
do not establish RStudio parity.
