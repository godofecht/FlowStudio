"""Reject Quarto executable forms that escape top-level fence validation."""
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


class QuartoContainerGuardTests(unittest.TestCase):
    def test_rejects_nested_executable_fences(self):
        for body in (
            '> \x60\x60\x60{bash}\n> echo unapproved\n> \x60\x60\x60\n',
            '> > ~~~{python}\n> > print(1)\n> > ~~~\n',
            '- \x60\x60\x60{bash}\n  echo unapproved\n  \x60\x60\x60\n',
            '1. ~~~{r}\n   cat(1)\n   ~~~\n',
            '    \x60\x60\x60{bash}\n    echo unapproved\n    \x60\x60\x60\n',
            '> - \x60\x60\x60{bash}\n>   echo unapproved\n>   \x60\x60\x60\n',
        ):
            with self.subTest(body=body), self.assertRaisesRegex(
                quarto.RenderError, 'Nested Quarto executable fences'):
                quarto.standalone_document(HEADER + body)

    def test_rejects_unsafe_quoted_yaml_and_duplicate_keys(self):
        for header in (
            'title: "{{< include /etc/passwd >}}"\nformat: html',
            "author: '{{% include other.qmd %}}'\nformat: html",
            "title: '\x60r 1 + 1\x60'\nformat: html",
            'title: First\ntitle: Second\nformat: html',
            'format: html\nauthor: A\nauthor: B',
        ):
            with self.subTest(header=header), self.assertRaises(quarto.RenderError):
                quarto.standalone_document('---\n' + header + '\n---\n')

    def test_rejects_direct_submission_before_starting_quarto(self):
        for source in (
            HEADER + '> \x60\x60\x60{bash}\n> echo unexpected\n> \x60\x60\x60\n',
            '---\ntitle: "{{< include /etc/passwd >}}"\nformat: html\n---\n',
        ):
            with self.subTest(source=source), mock.patch.object(quarto.subprocess, 'Popen') as launch:
                with self.assertRaises(quarto.RenderError):
                    quarto.render(source)
                launch.assert_not_called()

    def test_preserves_safe_top_level_chunks_and_inert_containers(self):
        body = (
            '> A quoted paragraph, not executable code.\n'
            '> \x60\x60\x60text\n> literal sample\n> \x60\x60\x60\n'
            '\x60\x60\x60{r analysis}\ncat(42)\n\x60\x60\x60\n'
            '~~~{python check}\nprint(42)\n~~~\n'
        )
        rendered = quarto.standalone_document(HEADER + body)
        self.assertIn('cat(42)', rendered)
        self.assertIn('title: "Report"', rendered)


if __name__ == '__main__':
    unittest.main()
