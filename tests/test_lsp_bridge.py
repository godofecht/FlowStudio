"""Flow language server bridge: POST /api/lsp/request, /api/lsp/events, /api/lsp/status.

Live: needs the native server (FLOWSTUDIO_URL, default http://127.0.0.1:8751)
built from this tree, with `flow` on PATH. Every check talks to the real
`flow lsp` child the server starts.
"""
from __future__ import annotations

import json
import os
import signal
import time
import unittest
import urllib.error
import urllib.request
import uuid

URL = os.environ.get("FLOWSTUDIO_URL", "http://127.0.0.1:8751").rstrip("/")

SOURCE = (
    "function add_one(x: i32) -> i32 {\n"
    "    return x + 1\n"
    "}\n"
    "\n"
    "function main() -> i32 {\n"
    "    let y: i32 = add_one(2)\n"
    "    let z: i32 = add_one(y)\n"
    "    return z\n"
    "}\n"
)


def server_up() -> bool:
    try:
        with urllib.request.urlopen(URL + "/health", timeout=2) as response:
            return response.status == 200
    except (OSError, urllib.error.URLError):
        return False


def post(path: str, body: str, intent: bool = True) -> tuple[int, str]:
    headers = {"Content-Type": "application/json"}
    if intent:
        headers["X-FlowStudio-Intent"] = "run"
    request = urllib.request.Request(URL + path, data=body.encode("utf-8"), method="POST", headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return response.status, response.read().decode("utf-8")
    except urllib.error.HTTPError as error:
        return error.code, error.read().decode("utf-8")


class Client:
    def __init__(self) -> None:
        self.next_id = 100
        self.uri = "file:///flowstudio/lsp-test-%s/main.flow" % uuid.uuid4().hex[:8]
        self.version = 1

    def request(self, method: str, params: dict) -> dict:
        self.next_id += 1
        status, text = post("/api/lsp/request", json.dumps(
            {"jsonrpc": "2.0", "id": self.next_id, "method": method, "params": params}))
        if status != 200:
            raise AssertionError("%s answered %d: %s" % (method, status, text))
        message = json.loads(text)
        if message.get("id") != self.next_id:
            raise AssertionError("response id %r for request %d" % (message.get("id"), self.next_id))
        return message

    def notify(self, method: str, params: dict) -> None:
        status, text = post("/api/lsp/request", json.dumps({"jsonrpc": "2.0", "method": method, "params": params}))
        if status != 200 or text != "null":
            raise AssertionError("%s notification answered %d: %s" % (method, status, text))

    def open(self, text: str = SOURCE) -> None:
        self.notify("textDocument/didOpen", {"textDocument": {
            "uri": self.uri, "languageId": "flow", "version": self.version, "text": text}})

    def change(self, text: str) -> None:
        self.version += 1
        self.notify("textDocument/didChange", {"textDocument": {"uri": self.uri, "version": self.version},
                                               "contentChanges": [{"text": text}]})

    def at(self, line: int, character: int) -> dict:
        return {"textDocument": {"uri": self.uri}, "position": {"line": line, "character": character}}

    def diagnostics(self, want, seconds: float = 6.0) -> list:
        """Poll events until a publishDiagnostics for this uri satisfies want."""
        last = None
        deadline = time.time() + seconds
        while time.time() < deadline:
            status, text = post("/api/lsp/events", "")
            if status != 200:
                raise AssertionError("events answered %d: %s" % (status, text))
            for event in json.loads(text):
                if event.get("method") == "textDocument/publishDiagnostics" and \
                        event["params"]["uri"] == self.uri:
                    last = event["params"]["diagnostics"]
            if last is not None and want(last):
                return last
            time.sleep(0.15)
        raise AssertionError("no matching diagnostics; last were %r" % (last,))

    def close(self) -> None:
        self.notify("textDocument/didClose", {"textDocument": {"uri": self.uri}})


def status() -> dict:
    code, text = post("/api/lsp/status", "")
    if code != 200:
        raise AssertionError("status answered %d: %s" % (code, text))
    return json.loads(text)


@unittest.skipUnless(server_up(), "native FlowStudio server is not running at " + URL)
class LanguageServerBridgeTest(unittest.TestCase):
    def setUp(self) -> None:
        self.client = Client()
        initialize = self.client.request("initialize", {"processId": None, "rootUri": None, "capabilities": {}})
        caps = initialize["result"]["capabilities"]
        for name in ("hoverProvider", "definitionProvider", "renameProvider", "documentFormattingProvider"):
            self.assertIn(name, caps)
        self.client.open()

    def tearDown(self) -> None:
        self.client.close()

    def test_hover_returns_the_typechecked_signature(self) -> None:
        hover = self.client.request("textDocument/hover", self.client.at(5, 18))["result"]
        value = hover["contents"]["value"]
        self.assertIn("function add_one(x: i32) -> i32", value)
        self.assertIn("typechecked", value)

    def test_completion_offers_the_local_function(self) -> None:
        text = SOURCE.replace("    return z\n", "    return add\n")
        self.client.change(text)
        result = self.client.request("textDocument/completion", self.client.at(7, 14))["result"]
        items = result if isinstance(result, list) else result["items"]
        labels = {item["label"]: item for item in items}
        self.assertIn("add_one", labels)
        self.assertEqual(labels["add_one"]["kind"], 3)
        self.assertIn("i32", labels["add_one"].get("detail", ""))

    def test_type_error_produces_a_diagnostic(self) -> None:
        self.assertEqual(self.client.diagnostics(lambda d: True), [])
        broken = SOURCE.replace("    return x + 1\n", "    return \"one\"\n")
        self.client.change(broken)
        found = self.client.diagnostics(lambda d: len(d) > 0)
        messages = [d["message"] for d in found]
        self.assertTrue(any("non-i32" in m for m in messages), messages)
        self.assertEqual(found[0]["range"]["start"]["line"], 1)
        self.client.change(SOURCE)
        self.assertEqual(self.client.diagnostics(lambda d: d == []), [])

    def test_rename_edits_every_occurrence(self) -> None:
        prepared = self.client.request("textDocument/prepareRename", self.client.at(0, 12))["result"]
        self.assertEqual(prepared["placeholder"], "add_one")
        params = self.client.at(0, 12)
        params["newName"] = "increment"
        result = self.client.request("textDocument/rename", params)["result"]
        edits = result["changes"][self.client.uri]
        lines = SOURCE.split("\n")
        self.assertEqual(len(edits), SOURCE.count("add_one"))
        for edit in edits:
            start, end = edit["range"]["start"], edit["range"]["end"]
            self.assertEqual(lines[start["line"]][start["character"]:end["character"]], "add_one")
            self.assertEqual(edit["newText"], "increment")

    def test_definition_and_formatting(self) -> None:
        definition = self.client.request("textDocument/definition", self.client.at(5, 18))["result"]
        self.assertEqual(definition["uri"], self.client.uri)
        self.assertEqual(definition["range"]["start"]["line"], 0)
        messy = "function main() -> i32 {\nlet y: i32 = 1\n        return y\n}\n"
        self.client.change(messy)
        edits = self.client.request("textDocument/formatting", {
            "textDocument": {"uri": self.client.uri}, "options": {"tabSize": 4, "insertSpaces": True}})["result"]
        self.assertEqual(len(edits), 1)
        self.assertEqual(edits[0]["newText"], "function main() -> i32 {\n    let y: i32 = 1\n    return y\n}\n")

    def test_child_restarts_after_it_is_killed(self) -> None:
        before = status()
        self.assertTrue(before["running"])
        os.kill(before["pid"], signal.SIGKILL)
        time.sleep(0.2)
        # The next request starts a fresh server; it has not seen the document yet.
        self.client.request("textDocument/hover", self.client.at(5, 18))
        after = status()
        self.assertTrue(after["running"])
        self.assertNotEqual(after["pid"], before["pid"])
        self.assertEqual(after["generation"], before["generation"] + 1)
        code, text = post("/api/lsp/events", "")
        self.assertEqual(code, 200)
        started = [e for e in json.loads(text) if e.get("method") == "flowstudio/serverStarted"]
        self.assertEqual(started[-1]["params"]["generation"], after["generation"])
        # A client reopens its documents and everything works again.
        self.client.open()
        hover = self.client.request("textDocument/hover", self.client.at(5, 18))["result"]
        self.assertIn("function add_one(x: i32) -> i32", hover["contents"]["value"])

    def test_a_stuck_server_times_out_without_hanging_the_http_loop(self) -> None:
        pid = status()["pid"]
        os.kill(pid, signal.SIGSTOP)
        try:
            started = time.time()
            code, text = post("/api/lsp/request", json.dumps({"jsonrpc": "2.0", "id": 9, "method": "textDocument/hover",
                                                              "params": self.client.at(5, 18)}))
            elapsed = time.time() - started
            self.assertEqual(code, 504, text)
            self.assertLess(elapsed, 5.0)
            with urllib.request.urlopen(URL + "/health", timeout=2) as response:
                self.assertEqual(response.status, 200)
        finally:
            os.kill(pid, signal.SIGCONT)
        # The late answer to the timed-out request is dropped; the next one matches.
        hover = self.client.request("textDocument/hover", self.client.at(5, 18))["result"]
        self.assertIn("add_one", hover["contents"]["value"])
        self.assertEqual(status()["pid"], pid)

    def test_bad_requests_are_refused(self) -> None:
        self.assertEqual(post("/api/lsp/request", "not json")[0], 400)
        code, text = post("/api/lsp/request", json.dumps({"jsonrpc": "2.0", "id": 1, "method": "shutdown"}))
        self.assertEqual(code, 400)
        self.assertIn("shared", text)
        self.assertEqual(post("/api/lsp/request", json.dumps(
            {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}}), intent=False)[0], 404)
        # A string id comes back unchanged.
        code, text = post("/api/lsp/request", json.dumps({"jsonrpc": "2.0", "id": "abc", "method": "textDocument/hover",
                                                          "params": self.client.at(5, 18)}))
        self.assertEqual(code, 200)
        self.assertEqual(json.loads(text)["id"], "abc")


if __name__ == "__main__":
    unittest.main()
