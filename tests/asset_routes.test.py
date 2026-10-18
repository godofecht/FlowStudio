"""Static asset-route contract; native Flow compilation is a separate gate."""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]


class AssetRoutesTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.router = (ROOT / "src/data_routes.flow").read_text(encoding="utf-8")
        cls.main = (ROOT / "src/main.flow").read_text(encoding="utf-8")

    def test_dispatcher_invokes_allowlist_only_for_get(self):
        self.assertIn("import .data_routes { StaticAsset, data_route }", self.main)
        self.assertRegex(self.main, r'if eq\(method, "GET"\) \{\s*let asset: StaticAsset = data_route\(path\)')
        self.assertIn("io_read_text(asset.path)", self.main)
        self.assertNotIn("io_read_text(path)", self.main)

    def test_declared_assets_exist(self):
        paths = re.findall(r'path: "(web/[^"]+)"', self.router)
        self.assertEqual(len(paths), 12)
        for path in paths:
            with self.subTest(path=path):
                self.assertTrue((ROOT / path).is_file(), path)
                self.assertNotIn("..", path)

    def test_plot_and_data_html_scripts_are_allowlisted(self):
        for page in ("web/data.html", "web/plots.html", "web/console.html"):
            html = (ROOT / page).read_text(encoding="utf-8")
            scripts = re.findall(r'<script src="(?:\./)?([^"/]+)"', html)
            self.assertGreaterEqual(len(scripts), 2)
            for script in scripts:
                self.assertIn('"/' + script + '"', self.router)
                self.assertTrue((ROOT / "web" / script).is_file())

    def test_unknown_routes_have_no_fallback(self):
        self.assertIn('return StaticAsset { path: "", mime: "", found: false }', self.router)
        self.assertNotIn('"/" + url', self.router)


if __name__ == "__main__":
    unittest.main(verbosity=2)
