#!/usr/bin/env python3
"""Every Flow block in docs/FLOW_FOR_AI.md must compile.

The guide is given to AI models as the source of truth, so a wrong example
teaches a wrong program. Block kinds, by fence info string:

  flow        a whole program. `flow run` must build it and exit 0. When the
              next block is an `output` block, stdout must match it exactly.
  flow check  needs FlowStudio or a window. The strict emitter must accept
              it, with src/flowstudio.flow staged beside it the way the
              server stages checks. With FLOWSTUDIO_URL reachable, bridge
              programs also run through the live server.
  flow error  must fail the strict check (or the build), and the next
              `error` block must appear in the compiler output.

Run: python3 tests/test_flow_for_ai.py   (needs `flow` on PATH)
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GUIDE = ROOT / "docs" / "FLOW_FOR_AI.md"
BRIDGE = ROOT / "src" / "flowstudio.flow"
URL = os.environ.get("FLOWSTUDIO_URL", "http://127.0.0.1:8751").rstrip("/")
FENCE = re.compile(r"^```([^\n`]*)\n(.*?)^```\s*$", re.M | re.S)
RULE = "-" * 40


def blocks(text: str) -> list[dict]:
    found = []
    for match in FENCE.finditer(text):
        info = match.group(1).strip()
        line = text.count("\n", 0, match.start()) + 1
        found.append({"info": info, "body": match.group(2), "line": line})
    for index, block in enumerate(found):
        following = found[index + 1] if index + 1 < len(found) else None
        block["expect"] = following["body"] if following and following["info"] in ("output", "error") else None
    return [block for block in found if block["info"].split(" ")[0] == "flow"]


def program_output(stdout: str) -> str:
    """`flow run` frames the program's own stdout between two rules."""
    lines = stdout.splitlines()
    marks = [index for index, line in enumerate(lines) if line.strip() == RULE]
    if len(marks) < 2:
        return stdout
    return "\n".join(lines[marks[0] + 1:marks[-1]]) + "\n"


def staged(source: str) -> tuple[str, Path]:
    folder = tempfile.mkdtemp(prefix="flow-for-ai-")
    shutil.copyfile(BRIDGE, Path(folder) / "flowstudio.flow")
    program = Path(folder) / "prog.flow"
    program.write_text(source, encoding="utf-8")
    return folder, program


def strict_check(source: str) -> tuple[int, str]:
    folder, program = staged(source)
    try:
        result = subprocess.run(
            ["flow", "tool", "compiler/scripts/flowc_emit.flow", "--strict", str(program), str(program) + ".c"],
            capture_output=True, text=True, timeout=180, cwd=ROOT)
        return result.returncode, result.stdout + result.stderr
    finally:
        shutil.rmtree(folder, ignore_errors=True)


def flow_run(source: str) -> tuple[int, str, str]:
    folder, program = staged(source)
    try:
        result = subprocess.run(["flow", "run", str(program)], capture_output=True, text=True,
                                timeout=180, cwd=folder)
        return result.returncode, program_output(result.stdout), result.stdout + result.stderr
    finally:
        shutil.rmtree(folder, ignore_errors=True)


def server_up() -> bool:
    try:
        with urllib.request.urlopen(URL + "/health", timeout=2) as reply:
            return reply.status == 200
    except (OSError, urllib.error.URLError):
        return False


def live_run(source: str, route: str = "/api/run/flow", timeout: int = 120) -> tuple[int, str]:
    origin = "/".join(URL.split("/")[:3])
    request = urllib.request.Request(URL + route, data=source.encode("utf-8"), method="POST",
                                     headers={"X-FlowStudio-Intent": "run", "Origin": origin})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as reply:
            return reply.status, reply.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as error:
        return error.code, error.read().decode("utf-8", "replace")


def verify(block: dict) -> str | None:
    """Returns None when the block holds, else a failure description."""
    kind = block["info"].split(" ")[1] if " " in block["info"] else "run"
    source = block["body"]
    where = "FLOW_FOR_AI.md:%d" % block["line"]
    if kind == "run":
        code, output, log = flow_run(source)
        if code != 0:
            return "%s did not build and exit 0 (exit %d):\n%s" % (where, code, log[-2500:])
        if block["expect"] is not None and output != block["expect"]:
            return "%s printed\n%r\nbut the guide shows\n%r" % (where, output, block["expect"])
        return None
    if kind == "check":
        code, log = strict_check(source)
        if code != 0:
            return "%s failed the strict check:\n%s" % (where, log[-2500:])
        live = os.environ.get("FLOW_FOR_AI_LIVE", "1") != "0" and server_up()
        if live and "import flowstudio" in source:
            status, output = live_run(source)
            if status != 200:
                return "%s failed on the live FlowStudio server (HTTP %d):\n%s" % (where, status, output[-2500:])
        if live and "stdlib/gfx.flow" in source and shutil.which("emcc"):
            status, output = live_run(source, "/api/app/build", 300)
            if status != 200 or '"ok":true' not in output:
                return "%s did not build as a FlowStudio app (HTTP %d):\n%s" % (where, status, output[-2500:])
        return None
    if kind == "error":
        code, log = strict_check(source)
        if code == 0:
            run_code, _, run_log = flow_run(source)
            if run_code == 0:
                return "%s is labelled as an error but builds and runs" % where
            log = run_log
        wanted = (block["expect"] or "").strip()
        if wanted and wanted not in log:
            return "%s failed, but without the message %r. Output:\n%s" % (where, wanted, log[-2500:])
        return None
    return "%s has an unknown block kind %r" % (where, block["info"])


@unittest.skipUnless(shutil.which("flow"), "flow is not on PATH")
class FlowForAiGuide(unittest.TestCase):
    def test_guide_has_blocks_of_every_kind(self) -> None:
        found = blocks(GUIDE.read_text(encoding="utf-8"))
        kinds = {block["info"] for block in found}
        self.assertIn("flow", kinds)
        self.assertIn("flow check", kinds)
        self.assertIn("flow error", kinds)
        self.assertGreaterEqual(len(found), 15)

    def test_every_flow_block_compiles(self) -> None:
        found = blocks(GUIDE.read_text(encoding="utf-8"))
        with ThreadPoolExecutor(max_workers=int(os.environ.get("FLOW_FOR_AI_JOBS", "4"))) as pool:
            failures = [failure for failure in pool.map(verify, found) if failure]
        self.assertEqual(failures, [], "\n\n".join(failures))

    def test_checker_rejects_a_broken_program(self) -> None:
        """The harness itself must be able to fail."""
        broken = {"info": "flow", "body": "function main() -> i32 {\n    let xs: array<f64> = [1.0, 2.0]\n    println(xs[0])\n    return 0\n}\n",
                  "line": 0, "expect": None}
        self.assertIsNotNone(verify(broken))
        wrong_output = {"info": "flow", "body": "function main() -> i32 {\n    println(1)\n    return 0\n}\n",
                        "line": 0, "expect": "2\n"}
        self.assertIsNotNone(verify(wrong_output))
        not_an_error = {"info": "flow error", "body": "function main() -> i32 {\n    return 0\n}\n",
                        "line": 0, "expect": "anything"}
        self.assertIsNotNone(verify(not_an_error))


if __name__ == "__main__":
    unittest.main(verbosity=2)
