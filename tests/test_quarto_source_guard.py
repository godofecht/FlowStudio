"""The native Quarto endpoint must enforce browser codec restrictions itself."""
from __future__ import annotations

import importlib.util
from pathlib import Path
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("quarto_render", ROOT / "scripts/quarto_render.py")
quarto = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(quarto)

HEADER = '---\ntitle: "Report"\nformat: html\n---\n\n'


class QuartoSourceGuardTests(unittest.TestCase):
    def test_representable_r_python_and_disabled_r_chunks(self):
        body = (
            "## Report\nA normal [reference](https://example.com).\n\n"
            "\x60\x60\x60{r analysis}\nx <- 1\ncat(x)\n\x60\x60\x60\n\n"
            "~~~~{python evaluation}\nprint(42)\n~~~~\n\n"
            "\x60\x60\x60{r inactive, eval=FALSE}\nstop('disabled')\n\x60\x60\x60\n\n"
            "\x60\x60\x60flow\nfunction main() -> i32 { return 0 }\n\x60\x60\x60\n"
        )
        self.assertIn("embed-resources: true", quarto.standalone_document(HEADER + body))

    def test_rejects_unsupported_engines_and_chunk_options(self):
        for body in (
            "\x60\x60\x60{bash}\necho bad\n\x60\x60\x60",
            "\x60\x60\x60{python, eval=FALSE}\nprint(1)\n\x60\x60\x60",
            "\x60\x60\x60{r, eval=TRUE}\ncat(1)\n\x60\x60\x60",
            "\x60\x60\x60{r label, echo=FALSE}\ncat(1)\n\x60\x60\x60",
            "\x60\x60\x60{r bad!}\ncat(1)\n\x60\x60\x60",
            "\x60\x60\x60{=html}\n<script>alert(1)</script>\n\x60\x60\x60",
            "\x60\x60\x60{r}\n#| eval: false\ncat(1)\n\x60\x60\x60",
            "\x60\x60\x60{python}\nprint(1)\n#| label: late\n\x60\x60\x60",
        ):
            with self.subTest(body=body), self.assertRaises(quarto.RenderError):
                quarto.standalone_document(HEADER + body)

    def test_rejects_shortcode_and_inline_execution(self):
        for body in (
            "{{< include /etc/passwd >}}",
            '{{% include "other.qmd" %}}',
            "Value: \x60{r} system('id')\x60",
            "Value: \x60{python} print(1)\x60",
            "Value: \x60r 1 + 1\x60",
        ):
            with self.subTest(body=body), self.assertRaises(quarto.RenderError):
                quarto.standalone_document(HEADER + body)

    def test_literal_fences_remain_inert(self):
        body = "\x60\x60\x60text\n{{< literal >}}\n\x60{r} literal\x60\n#| eval: false\n\x60\x60\x60\n"
        self.assertIn("{{< literal >}}", quarto.standalone_document(HEADER + body))

    def test_rejects_unterminated_or_mismatched_fences(self):
        for body in (
            "~~~~{r}\ncat(1)\n\x60\x60\x60",
            "\x60\x60\x60\x60{r}\ncat(1)\n\x60\x60\x60",
            "\x60\x60\x60{r}\ncat(1)",
        ):
            with self.subTest(body=body), self.assertRaises(quarto.RenderError):
                quarto.standalone_document(HEADER + body)
        self.assertIn("cat(1)", quarto.standalone_document(
            HEADER + "\x60\x60\x60\x60{r}\ncat(1)\n\x60\x60\x60\x60\x60"))

    def test_invalid_direct_api_source_never_launches_quarto(self):
        with mock.patch.object(quarto.subprocess, "Popen") as launch:
            with self.assertRaises(quarto.RenderError):
                quarto.render(HEADER + "\x60\x60\x60{bash}\necho bad\n\x60\x60\x60")
            launch.assert_not_called()


if __name__ == "__main__":
    unittest.main()
