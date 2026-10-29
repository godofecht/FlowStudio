"""Deterministic tunnel policy/health tests; no network or SSH server needed."""
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
import importlib.util
import socket
import tempfile
import threading
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("ssh_tunnel", ROOT / "scripts/ssh_tunnel.py")
tunnel = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tunnel)


class FakeProcess:
    def __init__(self, code=None):
        self.code = code
        self.terminated = False
        self.killed = False
        self.waited = False

    def poll(self):
        return self.code

    def wait(self, timeout=None):
        self.waited = True
        return 0 if self.code is None else self.code

    def terminate(self):
        self.terminated = True
        self.code = 0

    def kill(self):
        self.killed = True
        self.code = -9


class TunnelTests(unittest.TestCase):
    def test_command_uses_strict_host_auth_and_loopback_only(self):
        command = tunnel.ssh_command("researcher@compute.example", ssh_port=2222)
        self.assertEqual(command[:3], ["ssh", "-N", "-T"])
        self.assertEqual(command[-5:], ["-p", "2222", "-L",
                         "127.0.0.1:8751:127.0.0.1:8751", "researcher@compute.example"])
        self.assertIn("StrictHostKeyChecking=yes", command)
        self.assertIn("BatchMode=yes", command)
        self.assertIn("ExitOnForwardFailure=yes", command)
        self.assertIn("PasswordAuthentication=no", command)
        self.assertIn("KbdInteractiveAuthentication=no", command)
        self.assertIn("ForwardAgent=no", command)
        self.assertIn("GatewayPorts=no", command)
        self.assertNotIn("-R", command)
        self.assertNotIn("-D", command)

    def test_rejects_option_injection_and_ambiguous_destination(self):
        for bad in ("-oProxyCommand=evil", "example.com", "a@-oEvil", "a@host;touch /tmp/x",
                    "a@host:2222", "a@host/dir", "a@host..com", "a@host.", "a@", "@host"):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                tunnel.ssh_command(bad)
        for bad in (0, -1, 65536, True):
            with self.subTest(port=bad), self.assertRaises(ValueError):
                tunnel.ssh_command("a@host", ssh_port=bad)

    def test_explicit_identity_must_exist_and_is_one_argument(self):
        with tempfile.TemporaryDirectory() as tmp:
            key = Path(tmp) / "identity with spaces"
            key.write_text("dummy")
            command = tunnel.ssh_command("a@host", identity=str(key))
            self.assertEqual(command[command.index("-i") + 1], str(key.resolve()))
            with self.assertRaises(ValueError):
                tunnel.ssh_command("a@host", identity=str(key) + "-missing")

    def test_local_port_collision_is_rejected(self):
        with socket.socket() as occupied:
            occupied.bind(("127.0.0.1", 0))
            with self.assertRaisesRegex(RuntimeError, "occupied"):
                tunnel.require_free_local_port(occupied.getsockname()[1])

    def test_real_http_health_requires_exact_response(self):
        class HealthHandler(BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b"FlowStudio ready" if self.path == "/health" else b"other")
            def log_message(self, *_args):
                pass
        with HTTPServer(("127.0.0.1", 0), HealthHandler) as server:
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                port = server.server_address[1]
                self.assertTrue(tunnel.remote_health(port))
                tunnel.wait_for_tunnel(FakeProcess(), timeout=1, port=port)
            finally:
                server.shutdown()
                thread.join(timeout=2)

    def test_health_failure_and_ssh_exit_are_distinct(self):
        with self.assertRaisesRegex(RuntimeError, "exit 255"):
            tunnel.wait_for_tunnel(FakeProcess(255), timeout=1)
        with patch.object(tunnel, "remote_health", return_value=False), \
             patch.object(tunnel.time, "sleep"), \
             patch.object(tunnel.time, "monotonic", side_effect=[0, 1]):
            with self.assertRaisesRegex(RuntimeError, "no FlowStudio"):
                tunnel.wait_for_tunnel(FakeProcess(), timeout=0.5)

    def test_connection_never_launches_when_port_occupied(self):
        with patch.object(tunnel.shutil, "which", return_value="/usr/bin/ssh"), \
             patch.object(tunnel, "require_free_local_port", side_effect=RuntimeError("occupied")), \
             patch.object(tunnel.subprocess, "Popen") as popen:
            with self.assertRaisesRegex(RuntimeError, "occupied"):
                tunnel.connect("a@host")
            popen.assert_not_called()

    def test_disconnects_child_after_failed_health(self):
        process = FakeProcess()
        with patch.object(tunnel.shutil, "which", return_value="/usr/bin/ssh"), \
             patch.object(tunnel, "require_free_local_port"), \
             patch.object(tunnel.subprocess, "Popen", return_value=process), \
             patch.object(tunnel, "wait_for_tunnel", side_effect=RuntimeError("unhealthy")):
            with self.assertRaisesRegex(RuntimeError, "unhealthy"):
                tunnel.connect("a@host")
        self.assertTrue(process.terminated)
        self.assertTrue(process.waited)

    def test_cli_invalid_timeout_fails_without_ssh(self):
        self.assertEqual(tunnel.main(["a@host", "--timeout", "0"]), 1)
        self.assertEqual(tunnel.main(["a@host", "--timeout", "121"]), 1)


if __name__ == "__main__":
    unittest.main()
