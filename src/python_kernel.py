"""Length-framed, persistent native Python kernel for FlowStudio's loopback server.

Not a sandbox: code executes with the FlowStudio user's local permissions.
Protocol: stdin E/I/P opcode + 8 ASCII hex bytes + UTF-8 source; fd 3: status (0/1) +
8 ASCII hex bytes + UTF-8 captured output. One process per local server.
"""
from __future__ import annotations

import base64
import contextlib
import io
import json
import os
import sys
import traceback


MAX_SOURCE = 131072
MAX_OUTPUT = 131072
# Bounded matplotlib capture. The JSON must fit the C result buffer
# (128 KiB) together with its length frame; snapshots of the most recent
# run replace the previous capture, like the R kernel's plot snapshot.
MAX_FIGURES = 3
MAX_PLOT_JSON = 96 * 1024
plots: list[dict[str, object]] = []


class LimitedWriter(io.TextIOBase):
    def __init__(self) -> None:
        self.parts: list[str] = []
        self.used = 0
        self.truncated = False

    def write(self, value: str) -> int:
        if not isinstance(value, str):
            raise TypeError("expected str")
        value = value.replace("\x00", "\\0")
        raw = value.encode("utf-8", "replace")
        space = MAX_OUTPUT - self.used
        if space > 0:
            fragment = raw[:space].decode("utf-8", "ignore")
            self.parts.append(fragment)
            self.used += len(fragment.encode("utf-8"))
        if len(raw) > space:
            self.truncated = True
        return len(value)

    def flush(self) -> None:
        pass

    def result(self) -> bytes:
        message = "".join(self.parts)
        if self.truncated:
            suffix = "\n[Output truncated]"
            while len((message + suffix).encode("utf-8")) > MAX_OUTPUT:
                message = message[:-1]
            message += suffix
        return message.encode("utf-8")


def read_exact(stream: io.BufferedReader, count: int) -> bytes | None:
    chunks = bytearray()
    while len(chunks) < count:
        part = stream.read(count - len(chunks))
        if not part:
            return None
        chunks.extend(part)
    return bytes(chunks)


def prepare_matplotlib() -> None:
    """Select the non-DOM Agg renderer before pyplot is first imported."""
    try:
        import matplotlib
    except ImportError:
        return
    if "matplotlib.pyplot" not in sys.modules:
        matplotlib.use("Agg")


def close_previous_figures() -> None:
    """Discard figures rendered for an earlier run so snapshots stay fresh."""
    pyplot = sys.modules.get("matplotlib.pyplot")
    if pyplot is None:
        return
    for number in list(pyplot.get_fignums()):
        try:
            pyplot.close(number)
        except Exception:
            continue


def capture_plots() -> None:
    """Snapshot the run's open figures as bounded PNG base64 entries.

    One broken or oversized figure must not hide the rest; the total JSON
    stays under MAX_PLOT_JSON so the transport frame never overflows.
    """
    global plots
    plots = []
    pyplot = sys.modules.get("matplotlib.pyplot")
    if pyplot is None:
        return
    used = 0
    for number in list(pyplot.get_fignums())[-MAX_FIGURES:]:
        buffer = io.BytesIO()
        try:
            pyplot.figure(number).savefig(buffer, format="png", dpi=85)
        except Exception:
            continue
        png = base64.b64encode(buffer.getvalue()).decode("ascii")
        if used + len(png) > MAX_PLOT_JSON:
            break
        used += len(png)
        plots.append({"number": number, "png": png})


def plot_snapshot() -> bytes:
    """Return the latest run's captured figures as bounded JSON."""
    payload = json.dumps({"plots": plots}, separators=(",", ":")).encode("ascii")
    if len(payload) > MAX_PLOT_JSON:
        return b'{"plots":[]}'
    return payload


MAX_INSPECT_NODES = 256
MAX_INSPECT_CHILDREN = 12
MAX_INSPECT_DEPTH = 2


def inspect_namespace(namespace: dict[str, object]) -> bytes:
    """Inspect exact built-in containers without running user-defined methods.

    Child nodes are bounded and carry types/sizes, never repr() values. This
    avoids executing __repr__, __iter__, __getitem__ or descriptor code on
    arbitrary user objects. No numpy/pandas objects are traversed.
    """
    limits = {"nodes": 0, "truncated": False}

    def describe(name: str, value: object, depth: int,
                 ancestors: frozenset[int]) -> dict[str, object] | None:
        if limits["nodes"] >= MAX_INSPECT_NODES:
            limits["truncated"] = True
            return None
        limits["nodes"] += 1
        exact_type = type(value)
        kind = type.__getattribute__(exact_type, "__name__")[:100]
        size = len(value) if exact_type in (
            str, bytes, list, tuple, dict, set, frozenset) else None
        node: dict[str, object] = {
            "name": name[:160], "type": kind, "size": size
        }
        if depth >= MAX_INSPECT_DEPTH or exact_type not in (list, tuple, dict):
            return node
        if id(value) in ancestors:
            node["cycle"] = True
            return node

        children: list[dict[str, object]] = []
        next_ancestors = ancestors | {id(value)}
        if exact_type in (list, tuple):
            for index in range(min(size, MAX_INSPECT_CHILDREN)):
                child = describe(f"[{index}]", value[index], depth + 1, next_ancestors)
                if child is None:
                    break
                children.append(child)
        else:
            # Only exact str/int keys are named. Never call user key __str__
            # or __repr__; dictionary iteration itself is a builtin operation.
            for index, (key, item) in enumerate(value.items()):
                if index >= MAX_INSPECT_CHILDREN:
                    break
                if type(key) is str:
                    label = "[" + json.dumps(key[:80], ensure_ascii=True) + "]"
                elif type(key) is int and key.bit_length() <= 512:
                    label = "[" + str(key) + "]"
                else:
                    limits["truncated"] = True
                    continue
                child = describe(label, item, depth + 1, next_ancestors)
                if child is None:
                    break
                children.append(child)
        if children:
            node["children"] = children
        if size > len(children):
            node["truncated"] = True
            limits["truncated"] = True
        return node

    variables: list[dict[str, object]] = []
    for name, value in namespace.items():
        if type(name) is not str or name.startswith("__"):
            continue
        if len(variables) >= 128:
            limits["truncated"] = True
            break
        entry = describe(name, value, 0, frozenset())
        if entry is None:
            break
        variables.append(entry)

    def serialize() -> bytes:
        return json.dumps(
            {"variables": variables, "truncated": limits["truncated"]},
            ensure_ascii=True, separators=(",", ":")).encode("utf-8")

    payload = serialize()
    while len(payload) > 65536 and variables:
        variables.pop()
        limits["truncated"] = True
        payload = serialize()
    return payload


def serve() -> None:
    namespace: dict[str, object] = {"__name__": "__main__"}
    from python_debugger import DebugSession, encode
    debugger = DebugSession()
    protocol = os.fdopen(3, "wb", buffering=0)
    stdin = sys.stdin.buffer
    while True:
        header = read_exact(stdin, 9)
        if header is None:
            return
        try:
            length = int(header[1:], 16)
        except ValueError:
            return
        if header[:1] not in (b"E", b"I", b"P", b"T", b"B", b"S", b"N", b"F", b"C", b"X", b"Q") or length > MAX_SOURCE or (header[:1] in (b"I", b"P", b"S", b"N", b"F", b"C", b"X", b"Q") and length != 0):
            return
        data = read_exact(stdin, length)
        if data is None:
            return
        if header[:1] in (b"B", b"S", b"N", b"F", b"C", b"X", b"Q"):
            if header[:1] == b"B":
                try:
                    ok, payload = encode(debugger.start(data.decode("utf-8", "strict"), namespace, LimitedWriter()))
                except UnicodeDecodeError:
                    ok, payload = encode({"state": "idle", "ok": False, "stack": [],
                                          "output": "", "message": "Invalid UTF-8 debugger request."})
            else:
                actions = {b"S": "step", b"N": "next", b"F": "finish", b"C": "continue", b"X": "stop", b"Q": "status"}
                ok, payload = encode(debugger.command(actions[header[:1]]))
        elif debugger.busy() and header[:1] != b"I":
            ok, payload = False, b"Python debugger is active; stop or finish it before normal execution."
        elif debugger.busy() and debugger.snapshot()["state"] == "running":
            ok, payload = False, b"Python debugger is executing; inspection is temporarily unavailable."
        elif header[:1] == b"I":
            ok = True
            payload = inspect_namespace(namespace)
        elif header[:1] == b"P":
            # Read-only: returns the bounded snapshot of the latest run's
            # captured figures without evaluating source.
            ok = True
            payload = plot_snapshot()
        elif header[:1] == b"T":
            try:
                source = data.decode("utf-8", "strict")
            except UnicodeDecodeError:
                ok = False
                payload = b'{"ok":false,"output":"Invalid UTF-8 source","events":[],"truncated":false}'
            else:
                # Loaded only for tracing: regular kernel imports and inspection
                # remain usable when this file is imported via spec_from_file_location.
                from python_trace import trace_source
                ok, payload = trace_source(source, namespace, LimitedWriter())
        else:
            output = LimitedWriter()
            ok = True
            prepare_matplotlib()
            close_previous_figures()
            with contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
                try:
                    source = data.decode("utf-8", "strict")
                    compiled = compile(source, "<FlowStudio Python>", "exec")
                    exec(compiled, namespace)
                except BaseException:
                    ok = False
                    traceback.print_exc()
            capture_plots()
            payload = output.result()
            if not payload:
                payload = b"(No output)" if ok else b"Execution failed."
        protocol.write((b"0" if ok else b"1") + f"{len(payload):08x}".encode("ascii") + payload)


if __name__ == "__main__":
    serve()
