"""Flow apps in the browser: POST /api/app/build, POST /api/app/start and
GET /flowapp/<build>/<file>.

Live: needs the native server (FLOWSTUDIO_URL, default 127.0.0.1:8751) with
flow and emcc on PATH.
"""
from __future__ import annotations

import json
import os
import shutil
import time
import unittest
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = os.environ.get("FLOWSTUDIO_URL", "http://127.0.0.1:8751").rstrip("/")


def server_up() -> bool:
    try:
        with urllib.request.urlopen(URL + "/health", timeout=2) as response:
            return response.status == 200
    except (OSError, urllib.error.URLError):
        return False


def build(source: str) -> tuple[int, dict]:
    request = urllib.request.Request(URL + "/api/app/build", data=source.encode("utf-8"), method="POST",
                                     headers={"X-FlowStudio-Intent": "run", "Content-Type": "text/plain"})
    try:
        with urllib.request.urlopen(request, timeout=240) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read())


def start(source: str) -> dict:
    request = urllib.request.Request(URL + "/api/app/start", data=source.encode("utf-8"), method="POST",
                                     headers={"X-FlowStudio-Intent": "run", "Content-Type": "text/plain"})
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.loads(response.read())


def get(path: str) -> tuple[int, str, bytes]:
    try:
        with urllib.request.urlopen(URL + path, timeout=10) as response:
            return response.status, response.headers.get("Content-Type", ""), response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.headers.get("Content-Type", ""), error.read()


@unittest.skipUnless(server_up() and shutil.which("flow") and shutil.which("emcc"),
                     "the FlowStudio server, flow and emcc are needed")
class FlowAppTests(unittest.TestCase):
    def test_graphics_example_builds_and_serves_webassembly(self) -> None:
        with open(os.path.join(ROOT, "examples/graphics/bouncing-tiles/app.flow"), encoding="utf-8") as handle:
            status, result = build(handle.read())
        self.assertEqual(status, 200, result)
        self.assertTrue(result["ok"])
        self.assertTrue(result["gfx"], "the canvas backend was used")
        self.assertEqual(result["log"], "")
        code, kind, body = get(f"/flowapp/{result['build']}/app.wasm")
        self.assertEqual((code, kind), (200, "application/wasm"))
        self.assertEqual(body[:4], b"\0asm", "the body is binary WebAssembly, NUL bytes included")
        code, kind, body = get(f"/flowapp/{result['build']}/app.js")
        self.assertEqual(code, 200)
        self.assertIn(b"createFlowModule", body)

    def test_type_errors_name_the_app_line_without_the_build_folder(self) -> None:
        status, result = build('import "stdlib/gfx.flow"\nfunction main() -> i32 {\n'
                               '    let g = gfx_open(200, 100, "x")\n    gfx_clear(g, 1, 2)\n    return 0\n}\n')
        self.assertEqual(status, 422)
        self.assertFalse(result["ok"])
        self.assertTrue(result["log"].startswith("app.flow:4:"), result["log"])
        self.assertNotIn("flowstudio-apps", result["log"])

    def test_only_known_files_of_live_builds_are_served(self) -> None:
        for path in ("/flowapp/1/../../etc/passwd", "/flowapp/999999/app.js", "/flowapp/x/app.js",
                     "/flowapp/1/app.flow"):
            self.assertEqual(get(path)[0], 404, path)
        # The /app/ scripts of the IDE are untouched by the app routes.
        self.assertEqual(get("/app/project_create.js")[0], 200)
        self.assertEqual(get("/app-host.html")[0], 200)

    def test_background_build_reports_stages_and_keeps_the_server_responsive(self) -> None:
        with open(os.path.join(ROOT, "examples/graphics/bouncing-tiles/app.flow"), encoding="utf-8") as handle:
            source = handle.read() + "\n# background build %f\n" % time.time()
        began = time.monotonic()
        first = start(source)
        self.assertLess(time.monotonic() - began, 2.0, "start returns before the build ends")
        self.assertIn(first["state"], ("check", "wasm"), first)
        build_number = first["build"]
        began = time.monotonic()
        code, _, body = get("/health")
        self.assertEqual((code, body), (200, b"FlowStudio ready"))
        self.assertLess(time.monotonic() - began, 1.0, "the server answers while emcc works")
        self.assertEqual(start(source)["build"], build_number, "the same source joins the running build")
        stages = set()
        deadline = time.monotonic() + 240
        while time.monotonic() < deadline:
            code, kind, body = get(f"/flowapp/{build_number}/status")
            self.assertEqual((code, kind), (200, "application/json; charset=utf-8"))
            status = json.loads(body)
            stages.add(status["state"])
            if status["state"] in ("done", "failed"):
                break
            self.assertIsInstance(status["elapsed"], int)
            time.sleep(0.05)
        self.assertEqual(status["state"], "done", status)
        self.assertTrue(status["ok"])
        self.assertIn("wasm", stages)
        self.assertEqual(get(f"/flowapp/{build_number}/app.wasm")[0], 200)
        again = start(source)
        self.assertEqual((again["build"], again["state"]), (build_number, "done"), "a kept good build is reused")


if __name__ == "__main__":
    unittest.main()
