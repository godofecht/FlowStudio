"""Static integration guards, not substitutes for native Flow compilation."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]


class IntegrationContract(unittest.TestCase):
    def test_kernel_import_and_routes(self):
        main = (ROOT / "src/main.flow").read_text()
        self.assertIn("import .kernel_session", main)
        self.assertIn('run_kernel("python", fs_body())', main)
        self.assertIn('run_kernel("r", fs_body())', main)
        self.assertIn('execute_flow(fs_body())', main)
        for endpoint in ("/api/inspect/python", "/api/inspect/r", "/api/reset/python", "/api/reset/r"):
            self.assertIn(endpoint, main)
        self.assertIn('fs_intent_allowed() == 1', main)

    def test_static_assets_are_explicitly_allowlisted(self):
        main = (ROOT / "src/main.flow").read_text()
        routes = (ROOT / "src/data_routes.flow").read_text()
        self.assertIn("import .data_routes", main)
        self.assertIn("data_route(path)", main)
        for path in ("/data", "/data.html", "/data_viewer.js", "/data_page.js", "/index.html"):
            self.assertIn('"' + path + '"', routes)
        self.assertNotIn('io_read_text(path)', main)

    def test_native_bridge_linked(self):
        build = (ROOT / "scripts/build.sh").read_text()
        self.assertIn('src/kernel_bridge.c', build)
        self.assertIn('src/http_bridge.c', build)
        self.assertIn('flowc_emit.flow --strict', build)

    def test_runtime_sources_present(self):
        for path in ("src/kernel_bridge.c", "src/kernel_session.flow", "scripts/python_kernel.py", "scripts/r_kernel.R"):
            self.assertTrue((ROOT / path).is_file(), path)


if __name__ == "__main__":
    unittest.main()
