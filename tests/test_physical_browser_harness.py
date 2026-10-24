"""Unit acceptance of the physical-browser runner's real HTTP and safety contracts.

These tests do not claim that Pyodide, webR or Flow ran in a physical browser.
The separate physical_browser_acceptance.py run is mandatory for that claim.
"""
import importlib.util
from pathlib import Path
import subprocess
import sys
import unittest
import urllib.request


ROOT = Path(__file__).resolve().parents[1]
RUNNER = ROOT / "tests" / "physical_browser_acceptance.py"
spec = importlib.util.spec_from_file_location("flowstudio_physical_browser", RUNNER)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PhysicalBrowserHarnessTests(unittest.TestCase):
    def test_serves_checked_in_browser_ide_without_replacing_runtime(self):
        expected = (ROOT / "docs" / "app" / "index.html").read_bytes()
        with module.static_server() as url:
            with urllib.request.urlopen(url, timeout=5) as response:
                self.assertEqual(response.status, 200)
                self.assertEqual(response.read(), expected)
            with urllib.request.urlopen(url + "python-worker.js", timeout=5) as response:
                self.assertIn(b"loadPyodide", response.read())

    def test_rejects_remote_execution_target_before_browser_launch(self):
        result = subprocess.run(
            [sys.executable, str(RUNNER), "--url", "https://example.org/app/", "--flow"],
            capture_output=True, text=True, timeout=10, check=False
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("loopback host", result.stderr)

    def test_refuses_native_flow_without_real_native_server(self):
        result = subprocess.run(
            [sys.executable, str(RUNNER), "--flow"],
            capture_output=True, text=True, timeout=10, check=False
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("--flow requires --url", result.stderr)


if __name__ == "__main__":
    unittest.main()
