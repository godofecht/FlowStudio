"""Orchestration tests; a fake server validates the gate, not FlowStudio parity."""
from __future__ import annotations

import importlib.util
from pathlib import Path
import socket
import tempfile
import unittest

MODULE = Path(__file__).resolve().parents[1] / "scripts/verify_native.py"
spec = importlib.util.spec_from_file_location("verify_native", MODULE)
assert spec and spec.loader
native = importlib.util.module_from_spec(spec)
spec.loader.exec_module(native)


class NativeGateTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root / "scripts").mkdir()
        (self.root / "tests").mkdir()
        (self.root / "build").mkdir()
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            self.port = sock.getsockname()[1]

    def tearDown(self):
        self.temp.cleanup()

    def fixture(self, build: str, smoke: str = "pass\n"):
        (self.root / "scripts/build.sh").write_text(build)
        (self.root / "tests/http_smoke.py").write_text(smoke)
        # A successful fake gate must also supply the new independent HTTP gate.
        (self.root / "tests/http_trigonometry_smoke.py").write_text("pass\n")

    def test_missing_files_fail_closed(self):
        with self.assertRaisesRegex(native.VerificationError, "Missing"):
            native.verify(self.root, self.port)

    def test_failed_build_never_starts_server(self):
        self.fixture("exit 23\n")
        with self.assertRaisesRegex(native.VerificationError, "exit code 23"):
            native.verify(self.root, self.port)

    def test_false_success_build_without_binary_rejected(self):
        self.fixture("exit 0\n")
        with self.assertRaisesRegex(native.VerificationError, "without an executable"):
            native.verify(self.root, self.port)

    def test_stale_binary_cannot_make_noop_build_pass(self):
        stale = self.root / "build/flowstudio"
        stale.write_text("#!/bin/sh\nexit 0\n")
        stale.chmod(0o755)
        self.fixture("exit 0\n")
        with self.assertRaisesRegex(native.VerificationError, "without an executable"):
            native.verify(self.root, self.port)
        self.assertFalse(stale.exists())

    def test_build_timeout_fails_closed(self):
        self.fixture("sleep 5\n")
        with self.assertRaisesRegex(native.VerificationError, "Timed out"):
            native.verify(self.root, self.port, build_timeout=1)

    def test_occupied_port_rejected_before_build(self):
        self.fixture("exit 0\n")
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", self.port))
            sock.listen()
            with self.assertRaisesRegex(native.VerificationError, "already in use"):
                native.verify(self.root, self.port)

    def test_exited_server_fails_readiness(self):
        self.fixture("printf '#!/bin/sh\\nexit 9\\n' > build/flowstudio\nchmod +x build/flowstudio\n")
        with self.assertRaisesRegex(native.VerificationError, "exited before readiness"):
            native.verify(self.root, self.port, startup_timeout=2)

    def test_fake_health_and_smoke_success_proves_gate_only(self):
        fake_server = '''#!/usr/bin/env python3
from http.server import HTTPServer, BaseHTTPRequestHandler
import sys
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        body = b"FlowStudio ready" if self.path == "/health" else b"missing"
        self.send_response(200 if self.path == "/health" else 404)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def log_message(self, *args): pass
HTTPServer(("127.0.0.1", int(sys.argv[1])) , Handler).serve_forever()
'''
        (self.root / "fake_runner.sh").write_text(
            "#!/bin/sh\nexec python3 " + str(self.root / "fake_server.py") + " " + str(self.port) + "\n")
        (self.root / "fake_server.py").write_text(fake_server)
        self.fixture("cp fake_runner.sh build/flowstudio\nchmod +x build/flowstudio\n", "print('fake smoke ran')\n")
        # A fake health endpoint and fake smoke script cannot satisfy the
        # new real-Git acceptance gate; a fixture test is mandatory.
        with self.assertRaisesRegex(native.VerificationError, "requires git and its fixture script"):
            native.verify(self.root, self.port, startup_timeout=8)

    def test_failed_smoke_is_not_pass(self):
        # The server is healthy but the acceptance script fails.
        fake_server = '''#!/usr/bin/env python3
from http.server import HTTPServer, BaseHTTPRequestHandler
import sys
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"FlowStudio ready")
    def log_message(self, *args): pass
HTTPServer(("127.0.0.1", int(sys.argv[1])), Handler).serve_forever()
'''
        (self.root / "fake_server.py").write_text(fake_server)
        (self.root / "fake_runner.sh").write_text(
            "#!/bin/sh\nexec python3 " + str(self.root / "fake_server.py") + " " + str(self.port) + "\n")
        self.fixture("cp fake_runner.sh build/flowstudio\nchmod +x build/flowstudio\n", "raise SystemExit(42)\n")
        with self.assertRaisesRegex(native.VerificationError, "HTTP smoke failed with exit code 42"):
            native.verify(self.root, self.port, startup_timeout=8)


if __name__ == "__main__":
    unittest.main()
