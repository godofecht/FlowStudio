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
        self.assertEqual(len(paths), len(set(paths)), "duplicate static file routes")
        self.assertIn("web/source_cells.js", paths)
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

    def test_native_browser_workspace_is_explicitly_allowlisted(self):
        assets = set(re.findall(r'path: "(docs/app/[^"]+)"', self.router))
        expected = {
            str(path.relative_to(ROOT))
            for path in (ROOT / "docs/app").iterdir()
            if path.suffix in {".js", ".html", ".py"}
        }
        self.assertEqual(assets, expected)
        self.assertIn('url == "/app/"', self.router)
        self.assertIn('url == "/app/index.html"', self.router)
        html = (ROOT / "docs/app/index.html").read_text(encoding="utf-8")
        for script in re.findall(r'<script src="\\./([^"]+)"', html):
            self.assertIn(f'url == "/app/{script}"', self.router)

    def test_unknown_routes_have_no_fallback(self):
        self.assertIn('return StaticAsset { path: "", mime: "", found: false }', self.router)
        self.assertNotIn('"/" + url', self.router)


if __name__ == "__main__":
    unittest.main(verbosity=2)
