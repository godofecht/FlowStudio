"""Native, single-user CPython breakpoint debugger for FlowStudio.

Executes source in the persistent Python namespace in a background thread.
The Flow-owned HTTP router remains the only network entry point. Not a sandbox.
"""
from __future__ import annotations

import contextlib
import json
import math
import operator
import re
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
MAX_CONDITION = 80
# Conditional breakpoints intentionally support only numeric local comparisons.
# Never eval() user-supplied expressions or invoke custom comparison methods.
_CONDITION = re.compile(
    r"([A-Za-z_][A-Za-z_0-9]*)(==|!=|>=|<=|>|<)(-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?)\Z"
)
_COMPARE = {"==": operator.eq, "!=": operator.ne, ">=": operator.ge,
            "<=": operator.le, ">": operator.gt, "<": operator.lt}
_MISSING = object()


def _parse_breakpoints(points: object, line_count: int) -> dict[int, tuple[str, str, int | float] | None]:
    if type(points) is not list or len(points) > MAX_BREAKPOINTS:
        raise ValueError("Expected at most 64 breakpoint entries.")
    result: dict[int, tuple[str, str, int | float] | None] = {}
    for point in points:
        condition = None
        if type(point) is int:
            line = point
        elif type(point) is dict and set(point) == {"line", "condition"}:
            line, expression = point["line"], point["condition"]
            if type(expression) is not str or len(expression) > MAX_CONDITION:
                raise ValueError("Invalid breakpoint condition.")
            match = _CONDITION.fullmatch(expression)
            if match is None:
                raise ValueError("Condition must be a numeric local comparison, e.g. i>=3.")
            name, comparison, literal = match.groups()
            number = float(literal) if "." in literal else int(literal)
            if type(number) is float and not math.isfinite(number):
                raise ValueError("Breakpoint condition must compare finite numbers.")
            condition = (name, comparison, number)
        else:
            raise ValueError("Invalid breakpoint entry.")
        if type(line) is not int or not 1 <= line <= line_count or line in result:
            raise ValueError("Invalid or duplicate breakpoint line.")
        result[line] = condition
    return result


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
        self.breakpoints: dict[int, tuple[str, str, int | float] | None] = {}
        self.source_lines = 0
        self.run_to_line: int | None = None
        self.frames: list[dict[str, object]] = []
        self.writer: Any = None
        self.ok = True
        self.message = ""
        self.stop_requested = False
        self.thread: threading.Thread | None = None
        self.pause_on_exception = False
        self.last_exception: BaseException | None = None
        self.exception: dict[str, object] | None = None

    def _snapshot(self) -> dict[str, object]:
        output = self.writer.result().decode("utf-8", "replace")[:MAX_OUTPUT] if self.writer else ""
        return {"state": self.state, "ok": self.ok, "stack": self.frames,
                "output": output, "message": self.message[:1024],
                "exception": self.exception}

    def snapshot(self) -> dict[str, object]:
        with self.cv:
            return self._snapshot()

    def _breakpoint_hit(self, frame: Any) -> bool:
        condition = self.breakpoints.get(frame.f_lineno, _MISSING)
        if condition is _MISSING:
            return False
        if condition is None:
            return True
        name, comparison, number = condition
        value = frame.f_locals.get(name, _MISSING)
        if type(value) not in (int, float):
            return False
        if type(value) is float and not math.isfinite(value):
            return False
        # Exact built-in numbers only: never dispatch to user-defined __eq__/__lt__.
        return bool(_COMPARE[comparison](value, number))

    def _trace(self, frame: Any, event: str, arg: object) -> Any:
        if frame.f_code.co_filename != SOURCE_NAME or event not in ("line", "exception"):
            return self._trace
        with self.cv:
            if self.stop_requested:
                raise _Stopped()
            if event == "exception":
                if not self.pause_on_exception:
                    return self._trace
                exception_type, exception_value, _ = arg
                # A raised exception propagates through several source frames.
                # Pause at its first source frame, not once per unwinding frame.
                if exception_value is self.last_exception:
                    return self._trace
                self.last_exception = exception_value
                # Never invoke user exception __str__, __repr__ or attributes.
                self.exception = {"type": type.__getattribute__(exception_type, "__name__")[:80],
                                  "line": frame.f_lineno}
                pause = True
            else:
                depth = _source_depth(frame)
                pause = (self.run_to_line == frame.f_lineno or
                         self._breakpoint_hit(frame) or self.mode == "step" or
                         (self.mode == "next" and depth <= self.anchor_depth) or
                         (self.mode == "finish" and depth < self.anchor_depth))
                if pause:
                    self.exception = None
            if not pause:
                return self._trace
            # Run-to-line is temporary, even if an ordinary breakpoint or
            # exception interrupted execution before reaching its target.
            self.run_to_line = None
            self.anchor_depth = _source_depth(frame)
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
            self.run_to_line = None
            self.last_exception = None
            self.exception = None
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
            if type(request) is not dict or set(request) not in (
                    {"source", "breakpoints"}, {"source", "breakpoints", "pause_on_exception"}):
                raise ValueError("Expected source, breakpoints and optional pause_on_exception.")
            pause_on_exception = request.get("pause_on_exception", False)
            if type(pause_on_exception) is not bool:
                raise ValueError("pause_on_exception must be a boolean.")
            source, points = request["source"], request["breakpoints"]
            if type(source) is not str or not source or len(source.encode("utf-8")) > 120000:
                raise ValueError("Source must contain 1 to 120000 UTF-8 bytes.")
            parsed = _parse_breakpoints(points, len(source.splitlines()))
        except (ValueError, TypeError, UnicodeError) as exc:
            return {"state": "idle", "ok": False, "stack": [], "output": "", "message": str(exc)[:1024]}
        with self.cv:
            if self.state in ("running", "paused"):
                return {"state": self.state, "ok": False, "stack": [], "output": "", "message": "Debugger already active."}
            self.state = "running"
            self.mode = "run" if parsed or pause_on_exception else "step"
            self.anchor_depth = 0
            self.breakpoints = parsed
            self.source_lines = len(source.splitlines())
            self.run_to_line = None
            self.frames = []
            self.writer = writer
            self.ok = True
            self.message = ""
            self.stop_requested = False
            self.pause_on_exception = pause_on_exception
            self.last_exception = None
            self.exception = None
            self.thread = threading.Thread(target=self._execute, args=(source, namespace), daemon=True)
            self.thread.start()
            return self._wait()

    def command(self, action: str, target_line: int | None = None) -> dict[str, object]:
        with self.cv:
            if action == "status":
                return self._snapshot()
            if action not in ("step", "next", "finish", "continue", "stop", "run-to-line"):
                return {"state": self.state, "ok": False, "stack": [], "output": "", "message": "Unknown debugger command."}
            if action == "run-to-line" and (type(target_line) is not int or
                    not 1 <= target_line <= self.source_lines):
                return {**self._snapshot(), "ok": False,
                        "message": "Run-to-line target is outside the current source."}
            if action != "run-to-line" and target_line is not None:
                return {**self._snapshot(), "ok": False,
                        "message": "Unexpected run-to-line target."}
            if self.state not in ("paused", "running"):
                return {"state": self.state, "ok": False, "stack": self.frames, "output": "", "message": "No active debugging session."}
            if action == "stop":
                self.stop_requested = True
            elif self.state != "paused":
                return {"state": self.state, "ok": False, "stack": [], "output": "", "message": "Debugger has not reached a breakpoint."}
            self.run_to_line = target_line if action == "run-to-line" else None
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
