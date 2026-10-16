#!/usr/bin/env python3
"""Live HTTP smoke tests: start ./build/flowstudio from repo root first.

Unlike kernel_bridge.test.py, these exercise the Flow dispatcher. They cannot
pass until the native Flow compiler/link step has succeeded on the target OS.
"""
import json
import shutil
import urllib.error
import urllib.request

ROOT = "http://127.0.0.1:8751"
HEADERS = {"X-FlowStudio-Intent": "run", "Content-Type": "text/plain; charset=utf-8"}


def post(path, text=""):
    req = urllib.request.Request(ROOT + path, method="POST", data=text.encode(), headers=HEADERS)
    with urllib.request.urlopen(req, timeout=12) as response:
        return response.status, response.headers.get("Content-Type", ""), response.read().decode()


def get(path):
    with urllib.request.urlopen(ROOT + path, timeout=12) as response:
        return response.status, response.headers.get("Content-Type", ""), response.read().decode()


def main():
    for path, expected in [
        ("/data", "FlowStudio Data Viewer"),
        ("/data.html", "FlowStudio Data Viewer"),
        ("/data_viewer.js", "parseDelimited"),
        ("/data_page.js", "loadFile"),
        ("/index.html", "FlowStudio — Scientific IDE"),
    ]:
        status, _, body = get(path)
        assert status == 200 and expected in body, (path, status, body[:80])

    status, _, body = post("/api/reset/python")
    assert status == 200 and "reset" in body.lower(), (status, body)
    status, _, body = post("/api/run/python", "counter = 41")
    assert status == 200, (status, body)
    status, _, body = post("/api/run/python", "counter += 1\nprint(counter)")
    assert status == 200 and "42" in body, (status, body)
    status, mime, body = post("/api/inspect/python")
    assert status == 200 and "application/json" in mime, (status, mime)
    values = json.loads(body)["variables"]
    assert any(item["name"] == "counter" and "42" in item["preview"] for item in values), values
    status, _, body = post("/api/reset/python")
    assert status == 200, (status, body)
    status, _, body = post("/api/run/python", "print(counter)")
    assert "NameError" in body, body

    if shutil.which("R"):
        status, _, body = post("/api/reset/r")
        assert status == 200, (status, body)
        post("/api/run/r", "counter <- 41")
        status, _, body = post("/api/run/r", "cat(counter + 1, '\\n')")
        assert status == 200 and "42" in body, (status, body)
        status, _, body = post("/api/inspect/r")
        assert status == 200 and any(x["name"] == "counter" for x in json.loads(body)["variables"])
    else:
        print("SKIP R HTTP persistence: R not installed")
    print("PASS: served data viewer and persistent interpreter HTTP routes")


if __name__ == "__main__":
    main()
