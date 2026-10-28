#!/usr/bin/env python3
"""Render an explicitly approved Quarto HTML document in an isolated temp dir.

Invoked by the Flow-owned localhost HTTP router. This runs the installed
Quarto CLI and its R/Python engines with the local user's permissions.
"""
from __future__ import annotations

import pathlib
import re
import shutil
import subprocess
import sys
import tempfile

MAX_SOURCE = 128 * 1024
MAX_HTML = 2 * 1024 * 1024
MAX_LOG = 4096


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
    for i in range(1, end):
        if i in formats or not lines[i].strip():
            continue
        if not re.fullmatch(r"(?:title|author|date):\s*(?:[^#{}\[\]&*!|>'\"\x60]|\"[^\"\n]*\"|'[^'\n]*')*", lines[i]):
            raise RenderError("Unsupported Quarto YAML; export a restricted .qmd first.")
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
                result = subprocess.run(
                    [executable, "render", "report.qmd", "--to", "html",
                     "--output", "report.html", "--execute", "--no-cache"],
                    cwd=root, stdout=output, stderr=subprocess.STDOUT,
                    timeout=45, check=False,
                )
            except subprocess.TimeoutExpired as exc:
                raise RenderError("Quarto rendering exceeded 45 seconds.", 70) from exc
            except OSError as exc:
                raise RenderError("Could not start Quarto: " + str(exc), 69) from exc
        if result.returncode:
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
