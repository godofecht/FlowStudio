"""Verify every browser application asset is reachable through Flow's explicit GET allowlist."""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "docs" / "app"
ROUTES = ROOT / "src" / "data_routes.flow"


class NativeAppAssetRoutesTest(unittest.TestCase):
    def test_every_application_asset_has_an_explicit_route(self):
        text = ROUTES.read_text(encoding="utf-8")
        routes = re.findall(
            r'if url == "(/app/[^"]+)"\s*\{\s*'
            r'return StaticAsset \{ path: "(docs/app/[^"]+)", '
            r'mime: "([^"]+)", found: true \}', text
        )
        self.assertIn('url == "/app/index.html"', text)
        self.assertIn('path: "docs/app/index.html"', text)
        routes.append(("/app/index.html", "docs/app/index.html",
                       "text/html; charset=utf-8"))
        self.assertEqual(len(routes), len(set(route for route, _, _ in routes)),
                         "duplicate native application URLs")
        actual = {path.relative_to(ROOT).as_posix() for path in APP.iterdir()
                  if path.suffix in {".js", ".html", ".py"}}
        served = {path for _, path, _ in routes}
        self.assertEqual(actual, served)
        for url, path, mime in routes:
            self.assertEqual(url, "/" + path.removeprefix("docs/"))
            if path.endswith(".js"):
                self.assertEqual(mime, "text/javascript; charset=utf-8")
            elif path.endswith(".html"):
                self.assertEqual(mime, "text/html; charset=utf-8")
            else:
                self.assertEqual(mime, "text/plain; charset=utf-8")

    def test_every_script_in_browser_index_is_served(self):
        html = (APP / "index.html").read_text(encoding="utf-8")
        routes = ROUTES.read_text(encoding="utf-8")
        for script in re.findall(r'<script src="\./([^"]+)"', html):
            with self.subTest(script=script):
                self.assertIn(f'url == "/app/{script}"', routes)


if __name__ == "__main__":
    unittest.main()
