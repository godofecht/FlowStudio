"""FlowStudio static asset routing contract; native Flow compilation is a separate gate."""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]


class AssetRoutesTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.router = (ROOT / "src/data_routes.flow").read_text(encoding="utf-8")
        cls.main = (ROOT / "src/main.flow").read_text(encoding="utf-8")

    def test_dispatcher_reads_only_allowlisted_get_assets(self):
        self.assertIn("import .data_routes { StaticAsset, data_route }", self.main)
        self.assertIn("io_read_text(asset.path)", self.main)
        self.assertNotIn("io_read_text(path)", self.main)

    def test_declared_assets_exist_and_are_unique(self):
        paths = re.findall(r'path: "(web/[^"]+)"', self.router)
        self.assertEqual(len(paths), 29)
        self.assertEqual(len(paths), len(set(paths)))
        for name in paths:
            with self.subTest(path=name):
                self.assertTrue((ROOT / name).is_file(), name)
                self.assertNotIn("..", name)

    def test_viewer_scripts_are_allowlisted(self):
        for page in ("web/data.html", "web/plots.html", "web/console.html", "web/notebook.html", "web/packages.html"):
            html = (ROOT / page).read_text(encoding="utf-8")
            scripts = re.findall(r'<script src="(?:\./)?/?([^"/]+)"', html)
            self.assertGreaterEqual(len(scripts), 2)
            for script in scripts:
                self.assertIn('"/' + script + '"', self.router)
                self.assertTrue((ROOT / "web" / script).is_file())

    def test_no_arbitrary_route_fallback(self):
        self.assertIn('return StaticAsset { path: "", mime: "", found: false }', self.router)


if __name__ == "__main__":
    unittest.main(verbosity=2)
