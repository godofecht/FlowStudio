"""Bounded Matplotlib capture for FlowStudio's browser Python kernel.

The worker loads this module into Pyodide's virtual filesystem. The functions
also work under ordinary CPython, so rendering is independently testable.
"""

import base64
import io
import json
import sys

MAX_FIGURES = 4
MAX_PNG_BYTES = 1024 * 1024
MAX_TOTAL_BYTES = 3 * 1024 * 1024


class _LimitedBuffer(io.BytesIO):
    """Stop PNG encoding before its in-memory output exceeds the budget."""

    def __init__(self, limit):
        super().__init__()
        self.limit = max(0, limit)

    def write(self, data):
        if self.tell() + len(data) > self.limit:
            raise OverflowError("Plot PNG exceeds the capture budget")
        return super().write(data)


def prepare():
    """Select the non-DOM Agg renderer when Matplotlib is available."""
    try:
        import matplotlib
    except ImportError:
        return
    if "matplotlib.pyplot" not in sys.modules:
        matplotlib.use("Agg")


def capture():
    """Return JSON with PNG images of new figures; close rendered figures."""
    pyplot = sys.modules.get("matplotlib.pyplot")
    if pyplot is None:
        return "[]"

    numbers = list(pyplot.get_fignums())
    result = []
    total = 0
    try:
        for number in numbers[-MAX_FIGURES:]:
            try:
                image = _LimitedBuffer(min(MAX_PNG_BYTES, MAX_TOTAL_BYTES - total))
                pyplot.figure(number).savefig(image, format="png", dpi=85)
                raw = image.getvalue()
            except Exception:
                # One broken or oversized figure must not hide subsequent plots.
                continue
            total += len(raw)
            result.append({
                "number": int(number),
                "png": base64.b64encode(raw).decode("ascii"),
            })
    finally:
        for number in numbers:
            pyplot.close(number)
    return json.dumps(result, separators=(",", ":"))
