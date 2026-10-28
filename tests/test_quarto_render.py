"""Native Quarto subprocess/format contract; actual CLI acceptance if installed."""
from __future__ import annotations

import importlib.util
from pathlib import Path
import shutil
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("quarto_render", ROOT / "scripts/quarto_render.py")
quarto = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(quarto)

SOURCE = '---\ntitle: "Report"\nformat: html\n---\n\n## Actual markdown\n'


class QuartoRenderTests(unittest.TestCase):
    def test_standalone_metadata(self):
        result = quarto.standalone_document(SOURCE)
        self.assertIn("format:\n  html:\n    embed-resources: true", result)
        self.assertIn("## Actual markdown", result)

    def test_rejects_unsafe_or_unsupported_headers(self):
        for source in (
            "", "---\nformat: pdf\n---\n", "---\nformat: html\nexecute: false\n---\n",
            "---\nformat: html\nformat: html\n---\n",
            "---\nformat: html\n---\n\0", SOURCE + "a" * (128 * 1024),
        ):
            with self.subTest(source=source[:40]), self.assertRaises(quarto.RenderError):
                quarto.standalone_document(source)

    def test_missing_cli_is_explicit(self):
        with self.assertRaises(quarto.RenderError) as failure:
            quarto.render(SOURCE, "not-a-real-quarto-binary-flowstudio")
        self.assertEqual(failure.exception.status, 69)

    def test_real_subprocess_output_and_fixed_argv(self):
        # This controlled executable checks the process boundary, not Quarto
        # semantics. The optional real-Quarto test below covers that separately.
        with tempfile.TemporaryDirectory() as directory:
            executable = Path(directory) / "quarto-fixture"
            executable.write_text(
                "#!/usr/bin/env python3\n"
                "import pathlib,sys\n"
                "assert sys.argv[1:] == ['render','report.qmd','--to','html','--output','report.html','--execute','--no-cache']\n"
                "assert 'embed-resources: true' in pathlib.Path('report.qmd').read_text()\n"
                "pathlib.Path('report.html').write_text('<!doctype html><p>Rendered ✓</p>')\n",
                encoding="utf-8",
            )
            executable.chmod(0o755)
            self.assertEqual(quarto.render(SOURCE, str(executable)), "<!doctype html><p>Rendered ✓</p>")

    @unittest.skipUnless(shutil.which("quarto"), "real Quarto CLI not installed")
    def test_real_quarto_markdown_render(self):
        html = quarto.render(SOURCE)
        self.assertIn("Actual markdown", html)
        self.assertIn("<!doctype html>", html.lower())


if __name__ == "__main__":
    unittest.main()
