"""Native, single-user CPython breakpoint debugger for FlowStudio.

Executes source in the persistent Python namespace in a background thread.
The Flow-owned HTTP router remains the only network entry point. Not a sandbox.
"""
from __future__ import annotations

import contextlib
import json
import sys
import threading
import traceback
from typing import Any

SOURCE_NAME = "<FlowStudio Python>"
MAX_BREAKPOINTS = 64
MAX_FRAMES = 16
MAX_LOCALS = 16
MAX_OUTPUT = 32768
WAIT_SECONDS = 8.0


class _Stopped(BaseException):
    pass


def _preview(value: object) -> dict[str, str]:
    result = {"type": type.__getattribute__(type(value), "__name__")[:80]}
    if value is None:
        result["value"] = "None"
    elif type(value) in (bool, int, float, str):
        result["value"] = repr(value)[:120]
    return result


def _stack(frame: Any) -> list[dict[str, object]]:
    result: list[dict[str, object]] = []
    while frame is not None and len(result) < MAX_FRAMES:
        if frame.f_code.co_filename == SOURCE_NAME:
            values: dict[str, dict[str, str]] = {}
            for name, value in frame.f_locals.items():
                if type(name) is not str or name.startswith("__"):
                    continue
                if len(values) >= MAX_LOCALS:
                    break
                values[name[:80]] = _preview(value)
            result.append({"line": frame.f_lineno,
                           "function": frame.f_code.co_name[:80], "locals": values})
        frame = frame.f_back
    return result


def _source_depth(frame: Any) -> int:
    """Count only FlowStudio source frames; external library frames are excluded."""
    depth = 0
    while frame is not None:
        if frame.f_code.co_filename == SOURCE_NAME:
            depth += 1
        frame = frame.f_back
    return depth


class DebugSession:
    def __init__(self) -> None:
        self.cv = threading.Condition()
        self.state = "idle"
        self.mode = "run"
        self.anchor_depth = 0
        self.breakpoints: frozenset[int] = frozenset()
        self.frames: list[dict[str, object]] = []
        self.writer: Any = None
        self.ok = True
        self.message = ""
        self.stop_requested = False
        self.thread: threading.Thread | None = None

    def _snapshot(self) -> dict[str, object]:
        output = self.writer.result().decode("utf-8", "replace")[:MAX_OUTPUT] if self.writer else ""
        return {"state": self.state, "ok": self.ok, "stack": self.frames,
                "output": output, "message": self.message[:1024]}

    def snapshot(self) -> dict[str, object]:
        with self.cv:
            return self._snapshot()

    def _trace(self, frame: Any, event: str, arg: object) -> Any:
        if event != "line" or frame.f_code.co_filename != SOURCE_NAME:
            return self._trace
        with self.cv:
            if self.stop_requested:
                raise _Stopped()
            depth = _source_depth(frame)
            pause = (frame.f_lineno in self.breakpoints or self.mode == "step" or
                     (self.mode == "next" and depth <= self.anchor_depth) or
                     (self.mode == "finish" and depth < self.anchor_depth))
            if not pause:
                return self._trace
            self.anchor_depth = depth
            self.frames = _stack(frame)
            self.state = "paused"
            self.cv.notify_all()
            self.cv.wait_for(lambda: self.state != "paused")
            if self.stop_requested:
                raise _Stopped()
        return self._trace

    def _execute(self, source: str, namespace: dict[str, object]) -> None:
        ok, message = True, ""
        with contextlib.redirect_stdout(self.writer), contextlib.redirect_stderr(self.writer):
            try:
                compiled = compile(source, SOURCE_NAME, "exec")
                sys.settrace(self._trace)
                exec(compiled, namespace)
            except _Stopped:
                message = "Execution stopped by debugger."
            except BaseException:
                ok = False
                traceback.print_exc()
                message = "Python execution raised an exception."
            finally:
                sys.settrace(None)
        with self.cv:
            self.ok = ok
            self.message = message
            self.state = "stopped" if self.stop_requested else "done"
            self.cv.notify_all()

    def _wait(self) -> dict[str, object]:
        self.cv.wait_for(lambda: self.state in ("paused", "done", "stopped"), WAIT_SECONDS)
        return self._snapshot()

    def start(self, data: str, namespace: dict[str, object], writer: Any) -> dict[str, object]:
        try:
            request = json.loads(data)
            if type(request) is not dict or set(request) != {"source", "breakpoints"}:
                raise ValueError("Expected source and breakpoints.")
            source, points = request["source"], request["breakpoints"]
            if type(source) is not str or not source or len(source.encode("utf-8")) > 120000:
                raise ValueError("Source must contain 1 to 120000 UTF-8 bytes.")
            if type(points) is not list or len(points) > MAX_BREAKPOINTS or any(
                type(n) is not int or n < 1 or n > len(source.splitlines()) for n in points
            ) or len(set(points)) != len(points):
                raise ValueError("Invalid breakpoint line numbers.")
        except (ValueError, TypeError, UnicodeError) as exc:
            return {"state": "idle", "ok": False, "stack": [], "output": "", "message": str(exc)[:1024]}
        with self.cv:
            if self.state in ("running", "paused"):
                return {"state": self.state, "ok": False, "stack": [], "output": "", "message": "Debugger already active."}
            self.state = "running"
            self.mode = "run" if points else "step"
            self.anchor_depth = 0
            self.breakpoints = frozenset(points)
            self.frames = []
            self.writer = writer
            self.ok = True
            self.message = ""
            self.stop_requested = False
            self.thread = threading.Thread(target=self._execute, args=(source, namespace), daemon=True)
            self.thread.start()
            return self._wait()

    def command(self, action: str) -> dict[str, object]:
        with self.cv:
            if action == "status":
                return self._snapshot()
            if action not in ("step", "next", "finish", "continue", "stop"):
                return {"state": self.state, "ok": False, "stack": [], "output": "", "message": "Unknown debugger command."}
            if self.state not in ("paused", "running"):
                return {"state": self.state, "ok": False, "stack": self.frames, "output": "", "message": "No active debugging session."}
            if action == "stop":
                self.stop_requested = True
            elif self.state != "paused":
                return {"state": self.state, "ok": False, "stack": [], "output": "", "message": "Debugger has not reached a breakpoint."}
            self.mode = action if action in ("step", "next", "finish") else "run"
            if self.state == "paused":
                self.state = "running"
                self.cv.notify_all()
            return self._wait()

    def busy(self) -> bool:
        with self.cv:
            return self.state in ("running", "paused")


def encode(result: dict[str, object]) -> tuple[bool, bytes]:
    payload = json.dumps(result, ensure_ascii=True, separators=(",", ":")).encode("utf-8")
    if len(payload) > 131072:
        result = dict(result, output=str(result.get("output", ""))[:2048], stack=[],
                      message="Debugger snapshot truncated.")
        payload = json.dumps(result, ensure_ascii=True, separators=(",", ":")).encode("utf-8")
    return bool(result["ok"]), payload
