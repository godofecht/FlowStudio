"""Static wiring regression for FlowStudio editor draft recovery.

Run from the repository root: python3 -m unittest tests/test_recovery_wiring.py
This verifies shipped routes/scripts, not a physical browser save/reload cycle.
"""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]


class RecoveryWiringTests(unittest.TestCase):
    def test_allowlisted_asset(self):
        routes = (ROOT / "src/data_routes.flow").read_text(encoding="utf-8")
        self.assertIn('url == "/editor_recovery.js"', routes)
        self.assertIn('path: "web/editor_recovery.js"', routes)

    def test_served_editor_loads_controller(self):
        html = (ROOT / "web/index.html").read_text(encoding="utf-8")
        self.assertEqual(html.count('<script src="/editor_recovery.js"></script>'), 1)
        self.assertLess(html.index('<script src="/editor_recovery.js"></script>'),
                        html.index("</body>"))
        self.assertLess(html.index('id="source"'),
                        html.index('<script src="/editor_recovery.js"></script>'))

    def test_controller_has_real_recovery_controls(self):
        code = (ROOT / "web/editor_recovery.js").read_text(encoding="utf-8")
        for expected in ("createStore", "validDraft", "Restore draft",
                         "Discard draft", "localStorage", "MutationObserver",
                         'source.addEventListener("input"', "store.save("):
            self.assertIn(expected, code)

    def test_asset_route_remains_closed(self):
        routes = (ROOT / "src/data_routes.flow").read_text(encoding="utf-8")
        self.assertIn('found: false', routes)
        self.assertNotIn('return StaticAsset { path: url', routes)


if __name__ == "__main__":
    unittest.main()
