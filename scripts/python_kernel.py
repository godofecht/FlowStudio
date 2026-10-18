#!/usr/bin/env python3
"""FlowStudio's trusted persistent Python subprocess protocol (not a sandbox).

stdin:  E <byte-count>\n<UTF-8 source>, I 0\n, or Q 0\n
stdout: OK <byte-count>\n<UTF-8 output> or ERR <byte-count>\n<UTF-8 error>
Each command runs in a single persistent user namespace. Only the C bridge
should communicate with this process; code execution is intentionally trusted.
"""
from __future__ import annotations

import contextlib
import json
import sys
import traceback

MAX_CODE = 65536
MAX_OUTPUT = 1048576
SCOPE: dict[str, object] = {"__name__": "__flowstudio__"}
INPUT = sys.stdin.buffer
OUTPUT = sys.stdout.buffer


class BoundedOutput:
    """Capture at most 1 MiB without buffering unbounded user output."""
    def __init__(self) -> None:
        self.parts: list[str] = []
        self.bytes = 0
        self.overflow = False

    def write(self, text: str) -> int:
        encoded = text.encode("utf-8", errors="replace")
        if self.bytes + len(encoded) > MAX_OUTPUT:
            self.overflow = True
        elif not self.overflow:
            self.parts.append(text)
            self.bytes += len(encoded)
        return len(text)

    def flush(self) -> None:
        pass

    def getvalue(self) -> str:
        return "".join(self.parts)


def send(ok: bool, value: str) -> None:
    if "\x00" in value:
        ok = False
        value = "Kernel output contains unsupported NUL bytes.\n"
    data = value.encode("utf-8", errors="replace")
    if len(data) > MAX_OUTPUT:
        data = b"Output exceeded the 1 MiB response limit.\n"
        ok = False
    OUTPUT.write(("OK" if ok else "ERR").encode("ascii") + b" " + str(len(data)).encode("ascii") + b"\n")
    OUTPUT.write(data)
    OUTPUT.flush()


def evaluate(code: str) -> tuple[bool, str]:
    buffer = BoundedOutput()
    ok = True
    with contextlib.redirect_stdout(buffer), contextlib.redirect_stderr(buffer):
        try:
            compiled = compile(code, "<FlowStudio Python>", "exec")
            exec(compiled, SCOPE, SCOPE)
        except BaseException:
            ok = False
            traceback.print_exc(limit=12)
    if buffer.overflow:
        return False, "Output exceeded the 1 MiB response limit.\n"
    return ok, buffer.getvalue()


def inspect() -> str:
    variables = []
    for name, value in sorted(SCOPE.items()):
        if name.startswith("__"):
            continue
        try:
            typename = type(value).__name__
            preview = repr(value)[:160]
        except BaseException:
            typename, preview = "unknown", "<unrepresentable>"
        variables.append({"name": name, "type": typename, "preview": preview})
        if len(variables) >= 200:
            break
    return json.dumps({"variables": variables}, ensure_ascii=False)


def main() -> None:
    while True:
        header = INPUT.readline(64)
        if not header:
            break
        try:
            command, raw_length = header.rstrip(b"\n").split(b" ", 1)
            if command not in (b"E", b"I", b"Q") or not raw_length.isdigit():
                raise ValueError("Invalid kernel request header")
            length = int(raw_length)
            if length > MAX_CODE or (command != b"E" and length != 0):
                raise ValueError("Invalid kernel request length")
            data = INPUT.read(length)
            if len(data) != length:
                raise EOFError("Incomplete kernel request")
            if command == b"Q":
                send(True, "bye")
                break
            if command == b"I":
                send(True, inspect())
            else:
                ok, output = evaluate(data.decode("utf-8", errors="strict"))
                send(ok, output)
        except BaseException as error:
            send(False, type(error).__name__ + ": " + str(error))
            if isinstance(error, EOFError):
                break


if __name__ == "__main__":
    main()
