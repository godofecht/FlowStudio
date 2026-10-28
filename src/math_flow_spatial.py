"""Bounded, real spatial samples of solved periodic PDE fields.

The returned values are sampled from final NumPy state, not reconstructed
from initial conditions or placeholder graphics. Coordinates are x-major.
"""
from __future__ import annotations

import numpy as np

MAX_SPATIAL_AXIS = 24


def spatial_snapshot(fields: dict[str, np.ndarray], extent: tuple[float, float]) -> dict:
    if not fields:
        raise ValueError("At least one spatial field is required")
    first = next(iter(fields.values()))
    if first.ndim != 2 or min(first.shape) < 2:
        raise ValueError("Spatial fields must be two-dimensional")
    nx, ny = first.shape
    count_x, count_y = min(nx, MAX_SPATIAL_AXIS), min(ny, MAX_SPATIAL_AXIS)
    ix = np.linspace(0, nx - 1, count_x).astype(np.int64)
    iy = np.linspace(0, ny - 1, count_y).astype(np.int64)
    sampled = {}
    for name, field in fields.items():
        if field.shape != (nx, ny) or not np.all(np.isfinite(field)):
            raise ValueError("Spatial field dimensions or values are invalid")
        sampled[name] = field[np.ix_(ix, iy)].astype(float).tolist()
    if not all(np.isfinite(extent)) or min(extent) <= 0:
        raise ValueError("Spatial extent must be positive and finite")
    return {"grid": [count_x, count_y], "source_grid": [nx, ny],
            "extent": list(extent), "fields": sampled}
