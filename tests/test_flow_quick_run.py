"""src/flow_quick_run.sh: the -O0 build used for Flow console entries.

Needs `flow` and `cc` on PATH: python3 tests/test_flow_quick_run.py
"""
from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPT = os.path.join(ROOT, "src", "flow_quick_run.sh")
MARKER = "-" * 40


def run(source: str, env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    work = tempfile.mkdtemp(prefix="flowstudio-quick-")
    try:
        with open(os.path.join(work, "main.flow"), "w", encoding="utf-8") as handle:
            handle.write(source)
        shutil.copyfile(os.path.join(ROOT, "src", "flowstudio.flow"), os.path.join(work, "flowstudio.flow"))
        return subprocess.run(["sh", SCRIPT, work], cwd=ROOT, capture_output=True, text=True,
                              timeout=120, env=env, check=False)
    finally:
        shutil.rmtree(work, ignore_errors=True)


@unittest.skipUnless(shutil.which("flow") and shutil.which("cc"), "flow and cc are needed")
class QuickRunTest(unittest.TestCase):
    def test_output_sits_between_markers_and_exit_code_passes_through(self) -> None:
        done = run('function main() -> i32 {\n    println("ready")\n    return 3\n}\n')
        self.assertEqual(done.returncode, 3, done.stdout + done.stderr)
        lines = done.stdout.splitlines()
        self.assertEqual(lines[0], MARKER)
        self.assertEqual(lines[-1], MARKER)
        self.assertIn("ready", lines[1:-1])

    def test_source_errors_are_reported_without_the_private_directory(self) -> None:
        failed = run("function main() -> i32 {\n    return ???\n}\n")
        self.assertEqual(failed.returncode, 1)
        self.assertNotIn(MARKER, failed.stdout)
        self.assertRegex(failed.stdout, r"main\.flow:2:")
        self.assertNotIn("flowstudio-quick-", failed.stdout)

    def test_missing_flow_is_reported_like_flow_run(self) -> None:
        env = dict(os.environ, PATH="/usr/bin:/bin")
        if shutil.which("flow", path=env["PATH"]):
            self.skipTest("flow is installed in /usr/bin or /bin")
        missing = run("function main() -> i32 {\n    return 0\n}\n", env)
        self.assertEqual(missing.returncode, 127)
        self.assertIn("flow was not found", missing.stdout)


if __name__ == "__main__":
    unittest.main()
