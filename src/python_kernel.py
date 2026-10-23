"""Length-framed, persistent native Python kernel for FlowStudio's loopback server.

Not a sandbox. Code executes with the FlowStudio user's local permissions.
Protocol: stdin 8 ASCII hex bytes + UTF-8 source; fd 3: status (0/1) +
8 ASCII hex bytes + UTF-8 captured output. One process per local server.
"""
from __future__ import annotations

import contextlib
import io
import os
import sys
import traceback

MAX_SOURCE = 131072
MAX_OUTPUT = 131072


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


def serve() -> None:
    namespace: dict[str, object] = {"__name__": "__main__"}
    protocol = os.fdopen(3, "wb", buffering=0)
    stdin = sys.stdin.buffer
    while True:
        header = read_exact(stdin, 8)
        if header is None:
            return
        try:
            length = int(header, 16)
        except ValueError:
            return
        if length > MAX_SOURCE:
            return
        data = read_exact(stdin, length)
        if data is None:
            return
        output = LimitedWriter()
        ok = True
        with contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
            try:
                source = data.decode("utf-8", "strict")
                compiled = compile(source, "<FlowStudio Python>", "exec")
                exec(compiled, namespace)
            except BaseException:
                ok = False
                traceback.print_exc()
        payload = output.result()
        if not payload:
            payload = b"(No output)" if ok else b"Execution failed."
        protocol.write((b"0" if ok else b"1") + f"{len(payload):08x}".encode("ascii") + payload)


if __name__ == "__main__":
    serve()
