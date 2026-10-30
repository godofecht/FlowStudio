# Computed 32×32 tensor-diffusion heatmap from native Flow

`examples/native_tensor_grid.flow` evolves a periodic 32×32 anisotropic
diffusion tensor with a nonzero mixed derivative using the production Flow 2.0
compiler and a bounded native RK2 kernel. Two diagonal Fourier modes have
different semidiscrete eigenvalues, -69.632 and -53.248. The Flow program
asserts convergence, all-cell reference error, mass conservation, replay,
semigroup consistency, translation symmetry, parameter sensitivity and
negative resource/stability cases before printing any visualization.

After these checks, the program prints a single versioned
`FLOWSTUDIO_GRID_V1 32 32 1` frame with all 1,024 **computed** cells from
`fine32.grid`. The Flow-owned production `/api/run/flow` response carries
this stdout. The workbench's `web/native_field_plot.js` parses the bounded
frame and creates an SVG heatmap with one DOM rectangle per cell, row-major
coordinates, original numeric values and a shared numeric color scale.
No NumPy interpretation, precomputed image, browser simulation or HTML
injection is involved in this path.

For coupled two-species frames, each field now uses its **own computed**
minimum and maximum for the color ramp and its adjacent numeric extrema
labels. A shared global range would conceal a low-amplitude but spatially
varying species alongside a high-amplitude species. The SVG advertises
`data-native-flow-grid-scale="per-field"`; colors must therefore **not** be
compared quantitatively across species without reading each field's extrema.
Constant species render at the midpoint color. Raw numeric cell values are
retained in `data-grid-value` without rescaling. The 32-seed two-field
regression checks all rendered cells at unequal magnitudes, alongside
constant-field and per-field-extrema cases.

The protocol rejects duplicate/mixed frames, malformed headers, nonfinite
or excessive values, duplicate field names, incomplete data and dimensions
outside 3..32 per axis, at most 1,024 cells and two fields. Total output is
limited to 128 KiB. Existing `FLOWSTUDIO_FIELD_V1` one-dimensional plots
remain compatible.

```sh
node --test tests/native_grid_plot.test.js tests/native_field_plot.test.js
python3 -m unittest discover -s tests -p 'test_native_tensor32_oracle.py' -v
flow run examples/native_tensor_grid.flow
python3 scripts/verify_native.py --require-r
```

`tests/http_smoke.py` submits the exact checked-in source through production
Flow check/run routes and checks all 1,024 transmitted cells against the
independent semidiscrete Fourier formula (0.002 absolute tolerance, including
native text formatting). `tests/native_math_plot_ui.mjs` clicks Monaco's
actual Run button in Chromium and verifies the SVG contains 1,024 cells and
seven representative numerical values. Seeded JavaScript tests validate
parsing, finite SVG geometry, malformed input, rectangular layouts, multiple
fields and constant grids. These local parser tests do not establish native
execution on their own.

**Qualification:** Await Linux/macOS CI and post-merge acceptance. Local
Flow/R and independent macOS physical-browser testing remain unexecuted.
This is a bounded, array-based 2D numerical kernel and visualization,
**not** general compiler-backed multidimensional `field` grammar,
interactive solver debugging, multi-user isolation or RStudio parity.
