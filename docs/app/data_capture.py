"""Bounded, read-only tabular extraction from a persistent Python namespace.

Called by the Pyodide worker; never evaluates a user-provided expression.
"""
import json
import math
import re

MAX_ROWS = 200
MAX_COLUMNS = 32
MAX_CELL = 160
MAX_BYTES = 1024 * 1024
NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,119}$")


def _text(value):
    if value is None:
        return ""
    try:
        if isinstance(value, float) and math.isnan(value):
            return ""
        result = str(value)
    except Exception:
        result = "<unprintable>"
    return result[:MAX_CELL]


def capture(name, namespace):
    if not isinstance(name, str) or not NAME.fullmatch(name):
        raise ValueError("Invalid Python variable name")
    if name not in namespace:
        raise KeyError("Variable no longer exists")
    value = namespace[name]
    rows = []
    if hasattr(value, "iloc") and hasattr(value, "columns") and hasattr(value, "shape"):
        # pandas DataFrame: slice before conversion, never materialize the full frame.
        total_rows, total_columns = (int(n) for n in value.shape)
        width = min(total_columns, MAX_COLUMNS)
        columns = [_text(x) for x in list(value.columns[:width])]
        subset = value.iloc[:MAX_ROWS, :width]
        rows = [[_text(cell) for cell in row] for row in subset.itertuples(index=False, name=None)]
    elif getattr(value, "ndim", None) == 2 and hasattr(value, "shape"):
        # NumPy and other 2D sliceable arrays.
        total_rows, total_columns = (int(n) for n in value.shape)
        width = min(total_columns, MAX_COLUMNS)
        columns = ["Column " + str(i + 1) for i in range(width)]
        subset = value[:MAX_ROWS, :width]
        rows = [[_text(cell) for cell in row] for row in subset]
    elif isinstance(value, (list, tuple)) and value and all(isinstance(x, dict) for x in value[:MAX_ROWS]):
        total_rows = len(value)
        keys = []
        for item in value[:MAX_ROWS]:
            for key in item:
                if key not in keys:
                    keys.append(key)
                    if len(keys) >= MAX_COLUMNS:
                        break
            if len(keys) >= MAX_COLUMNS:
                break
        total_columns = len(keys)
        columns = [_text(key) for key in keys]
        rows = [[_text(item.get(key)) for key in keys] for item in value[:MAX_ROWS]]
    elif isinstance(value, (list, tuple)) and value and all(isinstance(x, (list, tuple)) for x in value[:MAX_ROWS]):
        total_rows = len(value)
        total_columns = max(len(row) for row in value[:MAX_ROWS])
        width = min(total_columns, MAX_COLUMNS)
        columns = ["Column " + str(i + 1) for i in range(width)]
        rows = [[_text(row[i]) if i < len(row) else "" for i in range(width)] for row in value[:MAX_ROWS]]
    else:
        raise TypeError("Select a DataFrame, 2D array, or list of records/rows")
    if total_rows < 0 or total_columns < 0 or not columns:
        raise ValueError("No tabular columns")
    result = {"columns": columns, "rows": rows,
              "totalRows": total_rows,
              "truncated": total_rows > MAX_ROWS or total_columns > MAX_COLUMNS}
    encoded = json.dumps(result, ensure_ascii=True, separators=(",", ":"))
    if len(encoded.encode("utf-8")) > MAX_BYTES:
        raise ValueError("Table exceeds the 1 MiB preview limit")
    return encoded
