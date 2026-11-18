"""Flow language server bridge: POST /api/lsp/request, /api/lsp/events, /api/lsp/status.

Live: needs the native server (FLOWSTUDIO_URL, default http://127.0.0.1:8751)
built from this tree, with `flow` on PATH. Every check talks to the real
`flow lsp` child the server starts.
"""
from __future__ import annotations

import json
import os
import shutil
import signal
import socket
import stat
import subprocess
import tempfile
import time
import unittest
import urllib.error
import urllib.request
import uuid

URL = os.environ.get("FLOWSTUDIO_URL", "http://127.0.0.1:8751").rstrip("/")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BINARY = os.path.join(ROOT, "build", "flowstudio")

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


def post(path: str, body: str, intent: bool = True, base: str = "") -> tuple[int, str]:
    headers = {"Content-Type": "application/json"}
    if intent:
        headers["X-FlowStudio-Intent"] = "run"
    request = urllib.request.Request((base or URL) + path, data=body.encode("utf-8"), method="POST", headers=headers)
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

    def test_start_answers_200_with_availability(self) -> None:
        code, text = post("/api/lsp/start", "")
        self.assertEqual(code, 200, text)
        self.assertEqual(json.loads(text), {"available": True})

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


UTIL = (
    "# Adds one.\n"
    "export function add_one(x: i32) -> i32 {\n"
    "    return x + 1\n"
    "}\n"
)
MAIN = (
    "import \"util.flow\"\n"
    "\n"
    "function main() -> i32 {\n"
    "    let y: i32 = add_one(2)\n"
    "    return y\n"
    "}\n"
)


def unbound(name: str):
    return lambda found: any(d["message"] == "unbound call '%s'" % name for d in found)


@unittest.skipUnless(server_up(), "native FlowStudio server is not running at " + URL)
class ProjectImportTest(unittest.TestCase):
    """Two documents of one project, one importing the other by file name.

    The browser never has a disk path for them. The bridge mirrors each
    opened document into a private folder, so `flow lsp` resolves the
    import there and answers with the browser's own URIs."""

    def setUp(self) -> None:
        self.root = "file:///flowstudio/import-test-%s/" % uuid.uuid4().hex[:8]
        self.util = Client()
        self.util.uri = self.root + "lib/util.flow"
        self.main = Client()
        self.main.uri = self.root + "lib/main.flow"
        self.main.request("initialize", {"processId": None, "rootUri": None, "capabilities": {}})

    def tearDown(self) -> None:
        for client in (self.main, self.util):
            post("/api/lsp/request", json.dumps({"jsonrpc": "2.0", "method": "textDocument/didClose",
                                                 "params": {"textDocument": {"uri": client.uri}}}))
        self.main.notify("flowstudio/forget", {"uri": self.root})

    def test_hover_completion_definition_and_references_cross_files(self) -> None:
        self.util.open(UTIL)
        self.main.open(MAIN)
        hover = self.main.request("textDocument/hover", self.main.at(3, 19))["result"]
        self.assertIn("function add_one(x: i32) -> i32", hover["contents"]["value"])
        self.assertIn("imported from:* `%s`" % self.util.uri, hover["contents"]["value"])

        definition = self.main.request("textDocument/definition", self.main.at(3, 19))["result"]
        self.assertEqual(definition["uri"], self.util.uri)
        self.assertEqual(definition["range"]["start"], {"line": 1, "character": 16})

        self.main.change(MAIN.replace("add_one(2)", "add_(2)"))
        result = self.main.request("textDocument/completion", self.main.at(3, 21))["result"]
        items = result if isinstance(result, list) else result["items"]
        self.assertIn("add_one", [item["label"] for item in items])
        self.main.change(MAIN)

        params = self.util.at(1, 18)
        params["context"] = {"includeDeclaration": True}
        references = self.util.request("textDocument/references", params)["result"]
        self.assertIn(self.main.uri, [item["uri"] for item in references])
        self.assertIn(self.util.uri, [item["uri"] for item in references])

    def test_import_diagnostics_follow_the_unsaved_text_of_the_other_file(self) -> None:
        # Before util.flow exists the call is unbound.
        self.main.open(MAIN)
        self.main.diagnostics(unbound("add_one"))
        # Opening util.flow puts it where the import looks.
        self.util.open(UTIL)
        self.main.change(MAIN)
        self.main.diagnostics(lambda found: not unbound("add_one")(found))
        # An unsaved rename in util.flow is what main.flow sees next.
        self.util.change(UTIL.replace("add_one", "add_two"))
        self.main.change(MAIN)
        self.main.diagnostics(unbound("add_one"))
        # forget removes the mirrored file.
        self.util.change(UTIL)
        self.main.notify("flowstudio/forget", {"uri": self.util.uri})
        self.main.change(MAIN)
        self.main.diagnostics(unbound("add_one"))

    def test_untitled_buffers_resolve_their_imports(self) -> None:
        # An untitled buffer is mirrored too, so its stdlib import is read
        # and typechecked, and its own functions still answer.
        scratch = Client()
        scratch.uri = "file:///flowstudio/untitled/doc-%s/scratch.flow" % uuid.uuid4().hex[:6]
        scratch.open(SOURCE.replace("function main", "import \"stdlib/math.flow\"\n\nfunction main", 1)
                     .replace("    return z\n", "    let w: f32 = subtract(1.0, 2.0)\n    return z\n"))
        try:
            hover = scratch.request("textDocument/hover", scratch.at(9, 19))["result"]["contents"]["value"]
            self.assertIn("function subtract(a: f32, b: f32) -> f32", hover)
            self.assertIn("imported from", hover)
            local = scratch.request("textDocument/hover", scratch.at(7, 18))["result"]["contents"]["value"]
            self.assertIn("function add_one(x: i32) -> i32", local)
        finally:
            scratch.close()

    def test_the_mirror_folder_never_reaches_the_browser(self) -> None:
        self.util.open(UTIL)
        self.main.open(MAIN)
        texts = []
        for method in ("textDocument/hover", "textDocument/definition"):
            status_code, text = post("/api/lsp/request", json.dumps({"jsonrpc": "2.0", "id": 7, "method": method,
                                                                     "params": self.main.at(3, 19)}))
            self.assertEqual(status_code, 200, text)
            texts.append(text)
        # The server names the imported file by its mirror path; the browser
        # gets the workspace URI in its place.
        self.assertIn("imported from:* `%s`" % self.util.uri, json.loads(texts[0])["result"]["contents"]["value"])
        self.assertEqual(json.loads(texts[1])["result"]["uri"], self.util.uri)
        time.sleep(0.6)
        texts.append(post("/api/lsp/events", "")[1])
        for text in texts:
            self.assertNotIn("flowstudio-lsp-", text)
            self.assertNotIn(os.environ.get("TMPDIR", "/tmp").rstrip("/"), text)

    def test_uris_outside_the_workspace_are_refused(self) -> None:
        bad = [
            "file:///etc/hosts",
            "/etc/hosts",
            "file:///flowstudio/../escape.flow",
            "file:///flowstudio/a/%2e%2e/%2E%2E/escape.flow",
            "file:///flowstudio/a//b.flow",
            "file:///flowstudio/a/./b.flow",
            "file:///flowstudio/a%00b.flow",
            "file:///flowstudio/a%2f..%2f..%2fescape.flow",
            "file:///flowstudio/a\\u002f..\\u002f..\\u002fescape.flow",
        ]
        for uri in bad:
            # Build the body by hand so the escaped form reaches the bridge as written.
            body = ('{"jsonrpc":"2.0","method":"textDocument/didOpen","params":{"textDocument":'
                    '{"uri":"%s","languageId":"flow","version":1,"text":"x"}}}' % uri)
            status_code, text = post("/api/lsp/request", body)
            self.assertEqual(status_code, 400, uri + ": " + text)
            status_code, text = post("/api/lsp/request", json.dumps({"jsonrpc": "2.0", "method": "flowstudio/forget",
                                                                     "params": {"uri": json.loads('"%s"' % uri)}}))
            self.assertEqual(status_code, 400, uri + ": " + text)


# The first `flow lsp` on a machine builds the server from source. On a
# 2-core Linux runner that took about 12 s, past the bridge's 10 s handshake.
SLOW_START_SECONDS = 13


@unittest.skipUnless(os.path.exists(BINARY) and shutil.which("flow"),
                     "needs build/flowstudio and flow on PATH")
class SlowFirstStartTest(unittest.TestCase):
    """A server that needs longer than the handshake allows still comes up.

    A wrapper named flow sits first on PATH and sleeps before it runs the
    real `flow lsp`, the way a first start does while it builds. Before the
    fix the bridge killed it after 10 s, so the build never finished.
    """

    def setUp(self) -> None:
        self.dir = tempfile.mkdtemp(prefix="flowstudio-slow-lsp-")
        wrapper = os.path.join(self.dir, "flow")
        with open(wrapper, "w") as handle:
            handle.write("#!/bin/sh\n"
                         "if [ \"$1\" = lsp ]; then sleep %d; fi\n"
                         "exec '%s' \"$@\"\n" % (SLOW_START_SECONDS, shutil.which("flow")))
        os.chmod(wrapper, os.stat(wrapper).st_mode | stat.S_IXUSR)
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        self.base = "http://127.0.0.1:%d" % port
        env = dict(os.environ, FLOWSTUDIO_PORT=str(port), PATH=self.dir + os.pathsep + os.environ["PATH"])
        self.server = subprocess.Popen([BINARY], cwd=ROOT, env=env,
                                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(100):
            try:
                with urllib.request.urlopen(self.base + "/health", timeout=1):
                    break
            except OSError:
                time.sleep(0.1)

    def tearDown(self) -> None:
        self.server.terminate()
        try:
            self.server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.server.kill()
        shutil.rmtree(self.dir, ignore_errors=True)

    def call(self, op: str) -> dict:
        code, text = post("/api/lsp/" + op, "", base=self.base)
        self.assertEqual(code, 200, text)
        return json.loads(text)

    def test_a_start_slower_than_the_handshake_finishes(self) -> None:
        began = time.time()
        self.assertEqual(self.call("start"), {"available": False, "starting": True})
        self.assertLess(time.time() - began, 12.0)
        state = self.call("status")
        self.assertTrue(state["starting"])
        self.assertFalse(state["running"])
        pid = state["pid"]
        # While it starts, other routes answer at once and the child is kept.
        began = time.time()
        with urllib.request.urlopen(self.base + "/health", timeout=2) as response:
            self.assertEqual(response.status, 200)
        self.assertLess(time.time() - began, 1.0)
        answer = self.call("start")
        while answer.get("starting") and time.time() - began < 30:
            self.assertEqual(self.call("status")["pid"], pid)
            time.sleep(0.5)
            answer = self.call("start")
        self.assertEqual(answer, {"available": True})
        state = self.call("status")
        self.assertTrue(state["running"])
        self.assertEqual(state["pid"], pid)
        self.assertEqual(state["generation"], 1)
        code, text = post("/api/lsp/request", json.dumps({"jsonrpc": "2.0", "id": 7, "method": "initialize",
                                                          "params": {"processId": None, "rootUri": None,
                                                                     "capabilities": {}}}), base=self.base)
        self.assertEqual(code, 200, text)
        self.assertIn("hoverProvider", json.loads(text)["result"]["capabilities"])


if __name__ == "__main__":
    unittest.main()
