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
            image = io.BytesIO()
            pyplot.figure(number).savefig(image, format="png", dpi=85)
            raw = image.getvalue()
            if len(raw) > MAX_PNG_BYTES or total + len(raw) > MAX_TOTAL_BYTES:
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
