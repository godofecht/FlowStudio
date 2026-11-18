"""Negative process contracts for the strict native compilation path."""
from pathlib import Path
import shutil
import sys
import tempfile
import unittest

from scripts.verify_native_field_arrays import compile_and_run


class NativeFieldCompilePipeline(unittest.TestCase):
    def test_zero_exit_without_c_artifact_is_rejected(self):
        compiler = shutil.which("true")
        if compiler is None:
            self.skipTest("system true utility unavailable")
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "program.flow"
            source.write_text("function main() -> i32 { return 0 }\n")
            with self.assertRaisesRegex(ValueError, "produced no C artifact"):
                compile_and_run(Path(compiler), source, 3)

    def test_compiler_diagnostics_on_stdout_are_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            compiler = Path(directory) / "rejected_source"
            compiler.write_text("#!" + sys.executable + "\n"
                                "print('field declaration rejected at line 4')\n"
                                "raise SystemExit(7)\n")
            compiler.chmod(0o700)
            source = Path(directory) / "program.flow"
            source.write_text("bad source\n")
            with self.assertRaisesRegex(ValueError,
                                        "Flow returned 7: field declaration rejected at line 4"):
                compile_and_run(compiler, source, 3)
