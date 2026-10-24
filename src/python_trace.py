"""Bounded real CPython line tracing for the native FlowStudio kernel.

Runs user source in the existing persistent namespace. This is an execution
trace, not an interactive step debugger or a sandbox.
"""
from __future__ import annotations

import contextlib
import json
import sys
import time
import traceback
from typing import Any

MAX_EVENTS = 256
MAX_LOCALS = 16
MAX_RESPONSE = 131072
SOURCE_NAME = "<FlowStudio Python>"


def safe_preview(value: object) -> str | None:
    """Only render exact builtin scalars; never invoke user-defined repr()."""
    if value is None:
        return "None"
    if type(value) in (int, float, bool, str):
        return repr(value)[:100]
    return None


def trace_source(source: str, namespace: dict[str, object], writer: Any) -> tuple[bool, bytes]:
    """Execute source and return a bounded JSON trace plus captured output."""
    events: list[dict[str, object]] = []
    truncated = False
    start = time.perf_counter_ns()

    def on_trace(frame: Any, event: str, arg: object) -> Any:
        nonlocal truncated
        if event != "line" or frame.f_code.co_filename != SOURCE_NAME:
            return on_trace
        if len(events) >= MAX_EVENTS:
            truncated = True
            return on_trace
        values: dict[str, dict[str, str]] = {}
        for name, value in frame.f_locals.items():
            if not isinstance(name, str) or name.startswith("__"):
                continue
            if len(values) >= MAX_LOCALS:
                truncated = True
                break
            value_type = type.__getattribute__(type(value), "__name__")[:80]
            entry = {"type": value_type}
            preview = safe_preview(value)
            if preview is not None:
                entry["value"] = preview
            values[name[:80]] = entry
        events.append({
            "line": frame.f_lineno,
            "function": frame.f_code.co_name[:80],
            "elapsed_ms": round((time.perf_counter_ns() - start) / 1000000, 3),
            "locals": values,
        })
        return on_trace

    previous_trace = sys.gettrace()
    ok = True
    with contextlib.redirect_stdout(writer), contextlib.redirect_stderr(writer):
        try:
            compiled = compile(source, SOURCE_NAME, "exec")
            sys.settrace(on_trace)
            exec(compiled, namespace)
        except BaseException:
            ok = False
            traceback.print_exc()
        finally:
            sys.settrace(previous_trace)

    # Bound output independently from trace events, preserving the kernel's
    # framing and avoiding oversized JSON responses.
    output = writer.result().decode("utf-8", "replace")[:32768]

    def encode() -> bytes:
        return json.dumps({"ok": ok, "output": output, "events": events,
                           "truncated": truncated}, ensure_ascii=True,
                          separators=(",", ":")).encode("utf-8")

    payload = encode()
    while len(payload) > MAX_RESPONSE and events:
        events.pop()
        truncated = True
        payload = encode()
    if len(payload) > MAX_RESPONSE:
        output = output[:4096]
        truncated = True
        payload = encode()
    return ok, payload
