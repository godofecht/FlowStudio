"""Length-framed, persistent native Python kernel for FlowStudio's loopback server.

Not a sandbox. Code executes with the FlowStudio user's local permissions.
Protocol: stdin E/I opcode + 8 ASCII hex bytes + UTF-8 source; fd 3: status (0/1) +
8 ASCII hex bytes + UTF-8 captured output. One process per local server.
"""
from __future__ import annotations

import contextlib
import io
import json
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



def inspect_namespace(namespace: dict[str, object]) -> bytes:
    """Bounded metadata only: never invoke repr(), properties or user methods."""
    variables: list[dict[str, object]] = []
    truncated = False
    for name, value in namespace.items():
        if type(name) is not str or name.startswith("__"):
            continue
        if len(variables) >= 128:
            truncated = True
            break
        kind = type.__getattribute__(type(value), "__name__")[:100]
        size = len(value) if type(value) in (str, bytes, list, tuple, dict, set, frozenset) else None
        variables.append({"name": name[:160], "type": kind, "size": size})
    payload = json.dumps({"variables": variables, "truncated": truncated},
                         ensure_ascii=True, separators=(",", ":")).encode("utf-8")
    while len(payload) > 65536 and variables:
        variables.pop()
        truncated = True
        payload = json.dumps({"variables": variables, "truncated": truncated},
                             ensure_ascii=True, separators=(",", ":")).encode("utf-8")
    return payload


def serve() -> None:
    namespace: dict[str, object] = {"__name__": "__main__"}
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
        if header[:1] not in (b"E", b"I") or length > MAX_SOURCE or (header[:1] == b"I" and length != 0):
            return
        data = read_exact(stdin, length)
        if data is None:
            return
        if header[:1] == b"I":
            ok = True
            payload = inspect_namespace(namespace)
        else:
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
