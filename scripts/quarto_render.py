#!/usr/bin/env python3
"""Render an explicitly approved Quarto HTML document in an isolated temp dir.

Invoked by the Flow-owned localhost HTTP router. This runs the installed
Quarto CLI and its R/Python engines with the local user's permissions.
"""
from __future__ import annotations

import os
import pathlib
import re
import signal
import shutil
import subprocess
import sys
import tempfile

MAX_SOURCE = 128 * 1024
MAX_HTML = 2 * 1024 * 1024
MAX_LOG = 4096


FENCE_OPEN = re.compile(r"^ {0,3}(\x60{3,}|~{3,})(.*)$")
FENCE_CLOSE = re.compile(r"^ {0,3}(\x60{3,}|~{3,})[ \t]*$")
CHUNK_HEADER = re.compile(
    r"^\{(r|python)(?:[ \t]+([A-Za-z][A-Za-z0-9_.-]{0,79}))?"
    r"(?:[ \t]*,[ \t]*(eval)[ \t]*=[ \t]*FALSE)?\}$"
)
INLINE_ENGINE = re.compile(r"\x60[ \t]*\{(?:r|python)\}[ \t]+\S", re.IGNORECASE)
INLINE_R = re.compile(r"(^|[^\\\x60])\x60r[ \t]+[^\x60\r\n]+\x60(?!\x60)")
# Pandoc can recognize fenced chunks inside blockquotes, list items and
# indented list continuations. These cannot be validated by the top-level
# fence scanner, so reject executable-looking nested fences rather than
# allowing an unvalidated engine through to Quarto.
NESTED_CHUNK_FENCE = re.compile(
    r"^[ \t]*(?:(?:>[ \t]*)|(?:[-+*]|[0-9]{1,9}[.)])[ \t]+)*"
    r"(?:\x60{3,}|~{3,})[ \t]*\{"
)


def unsupported_inline(line: str) -> bool:
    return ("{{<" in line or "{{%" in line
            or INLINE_ENGINE.search(line) is not None
            or INLINE_R.search(line) is not None)


def validate_quarto_body(lines: list[str]) -> None:
    """Enforce the browser notebook's representable Quarto execution surface.

    This is not a sandbox: approved R/Python chunks still run as the user.
    A direct HTTP client must not bypass the browser's source restrictions.
    """
    fence: tuple[str, int, bool] | None = None
    for line in lines:
        if fence is None:
            if unsupported_inline(line):
                raise RenderError("Quarto shortcodes and inline engines are unsupported.")
            match = FENCE_OPEN.fullmatch(line)
            if match is None:
                if NESTED_CHUNK_FENCE.match(line):
                    raise RenderError("Nested Quarto executable fences are unsupported.")
                continue
            marker, info = match.groups()
            info = info.strip()
            executable = info.startswith("{")
            if executable:
                header = CHUNK_HEADER.fullmatch(info)
                if header is None or (header.group(1) == "python" and header.group(3)):
                    raise RenderError("Only restricted R/Python Quarto chunks are supported.")
            fence = (marker[0], len(marker), executable)
        else:
            close = FENCE_CLOSE.fullmatch(line)
            if close is not None and close.group(1)[0] == fence[0] and len(close.group(1)) >= fence[1]:
                fence = None
            elif fence[2] and re.match(r"^[ \t]*#\|", line):
                raise RenderError("Quarto #| executable chunk options are unsupported.")
    if fence is not None:
        raise RenderError("Unterminated Quarto fenced code block.")


class RenderError(Exception):
    def __init__(self, message: str, status: int = 65):
        super().__init__(message)
        self.status = status


def standalone_document(source: str) -> str:
    """Require the restricted HTML header and force embedded resources."""
    if not isinstance(source, str) or not source or "\0" in source:
        raise RenderError("Quarto source must be nonempty UTF-8 without NUL bytes.")
    if len(source.encode("utf-8")) > MAX_SOURCE:
        raise RenderError("Quarto source exceeds the 128 KiB request limit.")
    lines = source.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    if lines[0] != "---":
        raise RenderError("Quarto rendering requires a YAML header with format: html.")
    try:
        end = lines.index("---", 1, 66)
    except ValueError as exc:
        raise RenderError("Quarto YAML header must close within 64 lines.") from exc
    formats = [i for i in range(1, end) if re.fullmatch(r"format:\s*html\s*", lines[i])]
    if len(formats) != 1:
        raise RenderError("Only a single scalar format: html is renderable.")
    # Do not accept arbitrary Quarto YAML from direct API callers. The browser
    # encoder produces only these inert scalar fields and the HTML format.
    seen_metadata: set[str] = set()
    for i in range(1, end):
        if i in formats or not lines[i].strip():
            continue
        if unsupported_inline(lines[i]):
            raise RenderError("Quarto metadata cannot contain shortcodes or inline engines.")
        if not re.fullmatch(r"(?:title|author|date):\s*(?:[^#{}\[\]&*!|>'\"\x60]|\"[^\"\n]*\"|'[^'\n]*')*", lines[i]):
            raise RenderError("Unsupported Quarto YAML; export a restricted .qmd first.")
        key = lines[i].split(":", 1)[0]
        if key in seen_metadata:
            raise RenderError("Duplicate Quarto metadata key.")
        seen_metadata.add(key)
    validate_quarto_body(lines[end + 1:])
    index = formats[0]
    lines[index:index + 1] = ["format:", "  html:", "    embed-resources: true"]
    return "\n".join(lines)


def render(source: str, executable: str = "quarto") -> str:
    prepared = standalone_document(source)
    if not shutil.which(executable):
        raise RenderError("Quarto CLI is not installed or not on PATH.", 69)
    with tempfile.TemporaryDirectory(prefix="flowstudio-quarto-") as directory:
        root = pathlib.Path(directory)
        (root / "report.qmd").write_text(prepared, encoding="utf-8")
        log = root / "render.log"
        # Fixed argv, no shell, no external project config in the temporary
        # directory. --execute is intentional; the UI requires consent.
        with log.open("wb") as output:
            try:
                process = subprocess.Popen(
                    [executable, "render", "report.qmd", "--to", "html",
                     "--output", "report.html", "--execute", "--no-cache"],
                    cwd=root, stdout=output, stderr=subprocess.STDOUT,
                    start_new_session=True,
                )
            except OSError as exc:
                raise RenderError("Could not start Quarto: " + str(exc), 69) from exc
            try:
                returncode = process.wait(timeout=45)
            except subprocess.TimeoutExpired as exc:
                # Quarto may spawn Rscript, Jupyter or Pandoc children. Kill
                # its entire session, not only the parent executable.
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass  # The child group may have exited after the timeout.
                process.wait()
                raise RenderError("Quarto rendering exceeded 45 seconds.", 70) from exc
        if returncode:
            detail = log.read_bytes()[-MAX_LOG:].decode("utf-8", errors="replace")
            raise RenderError("Quarto render failed: " + detail.strip())
        report = root / "report.html"
        if not report.is_file() or report.is_symlink():
            raise RenderError("Quarto did not produce report.html.")
        if report.stat().st_size > MAX_HTML:
            raise RenderError("Quarto HTML exceeds the 2 MiB standalone report limit.")
        html = report.read_text(encoding="utf-8")
        if "\0" in html or not html.strip():
            raise RenderError("Quarto produced an empty or invalid HTML report.")
        return html


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("Usage: quarto_render.py SOURCE_FILE", file=sys.stderr)
        return 64
    try:
        source = pathlib.Path(argv[1]).read_text(encoding="utf-8")
        sys.stdout.write(render(source))
        return 0
    except RenderError as exc:
        print(str(exc), file=sys.stderr)
        return exc.status
    except (OSError, UnicodeError) as exc:
        print("Quarto source or output could not be read: " + str(exc), file=sys.stderr)
        return 65


if __name__ == "__main__":
    sys.exit(main(sys.argv))
