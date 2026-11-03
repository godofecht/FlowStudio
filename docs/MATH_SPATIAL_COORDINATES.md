# Physical coordinates for computed mathematical Flow spatial plots

The bounded Python/NumPy mathematical Flow frontends return actual final-state
arrays for the checked-in Navier–Stokes and heat examples. When an axis has
more than 24 solver cells, the snapshot retains at most 24 point samples.
The previous SVG treated these irregularly selected samples as if their
physical positions were uniformly spaced, misplacing features and velocity
arrows on the plotted domain.

The `spatial.sample_indices` object now carries the **exact integer indices**
of the sampled solver cells in x-major order. The existing `grid`,
`source_grid`, `extent`, and `fields` contract is unchanged. The native
workbench validates both axes, including strictly increasing indices, exact
endpoints and source-grid bounds, before rendering. Its heatmap regions are
bounded by midpoints between sampled solver-cell centers, while velocity
vectors are anchored at the actual sampled centers. Older responses without
`sample_indices` retain the legacy uniform presentation.

For source-cell index `i`, source resolution `N` and extent `L`, the
physical coordinate is `(i + 1/2) L / N`. Between consecutive samples
`i` and `j`, the display boundary is `(i + j + 1) / (2N)` of the
SVG axis. This is a **nearest-sample visualization**, not a conservative
finite-volume average or a reconstructed continuous field; undersampled
high-frequency structure can still alias.

## Reproduction and qualification

```sh
python3 -m pip install numpy==2.1.3
python3 -m unittest discover -s tests -p test_math_flow_spatial.py -v
node --test tests/browser_math_flow_plot.test.js
python3 src/math_flow.py examples/navier_stokes_smoke.flow --grid 16 --until 0.005
python3 src/math_flow.py examples/heat_piecewise_forcing.flow --grid 16 --until 0.005
```

The checked-in tests assert exact x/y indices against NumPy sampling,
numerical field agreement, actual SVG rectangle positions and velocity
arrow coordinates, and fail-closed malformed metadata. Repository CI must
also execute the existing native Flow/R/Python HTTP, Navier–Stokes
manufactured-solution and physical Chromium acceptance on Linux/macOS.

This does **not** integrate the bounded PDE dialect into upstream Flow 2.0
grammar, add arbitrary tensor/PDE ASTs, implement native Navier–Stokes, or
establish complete multidimensional visualization.
