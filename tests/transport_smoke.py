#!/usr/bin/env python3
"""Run a production-transport native harness and probe its HTTP boundary."""
import pathlib
import socket
import subprocess
import tempfile
import unittest

PORT = 8751
HERE = pathlib.Path(__file__).resolve().parent


def raw_request(data: bytes) -> tuple[int, bytes]:
    with socket.create_connection(("127.0.0.1", PORT), timeout=3) as conn:
        conn.sendall(data)
        conn.shutdown(socket.SHUT_WR)
        chunks = []
        while True:
            part = conn.recv(65536)
            if not part:
                break
            chunks.append(part)
    raw = b"".join(chunks)
    return int(raw.split(b" ", 2)[1]), raw.partition(b"\r\n\r\n")[2]


def request(method="GET", path="/health", body=b"", headers=b"", host=b"127.0.0.1:8751"):
    req = (method.encode() + b" " + path.encode() + b" HTTP/1.1\r\nHost: " + host +
           b"\r\n" + headers + b"\r\n" + body)
    return raw_request(req)


class TransportTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tempdir = tempfile.TemporaryDirectory(prefix="flowstudio-transport-")
        binary = str(pathlib.Path(cls.tempdir.name) / "transport-harness")
        subprocess.run(["cc", "-std=c11", "-O2", "-Wall", "-Wextra", "-Werror",
                        str(HERE.parent / "src" / "http_bridge.c"),
                        str(HERE / "http_transport_harness.c"), "-o", binary],
                       check=True, capture_output=True, text=True)
        cls.proc = subprocess.Popen([binary], stdout=subprocess.PIPE,
                                    stderr=subprocess.PIPE, text=True)
        if cls.proc.stdout.readline().strip() != "READY":
            raise RuntimeError("Transport harness failed to start")

    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate()
        try:
            cls.proc.wait(timeout=2)
        except subprocess.TimeoutExpired:
            cls.proc.kill()
            cls.proc.wait(timeout=2)
        cls.tempdir.cleanup()

    def test_health(self):
        self.assertEqual(request(), (200, b"healthy"))

    def test_localhost_case_insensitive_host(self):
        self.assertEqual(request(host=b"LOCALHOST:8751"), (200, b"healthy"))

    def test_invalid_host_dns_rebinding(self):
        self.assertEqual(request(host=b"evil.invalid:8751")[0], 403)

    def test_duplicate_host_rejected(self):
        self.assertEqual(request(headers=b"Host: 127.0.0.1:8751\r\n")[0], 403)

    def test_no_intent_rejected(self):
        self.assertEqual(request("POST", "/api/run/python", b"x", b"Content-Length: 1\r\n")[0], 404)

    def test_origin_rejected(self):
        self.assertEqual(request("POST", "/api/run/python", b"x",
            b"Content-Length: 1\r\nX-FlowStudio-Intent: run\r\nOrigin: http://evil.invalid\r\n")[0], 404)

    def test_valid_post_body(self):
        self.assertEqual(request("POST", "/api/run/python", b"print(42)",
            b"content-length: 9\r\nx-flowstudio-intent: run\r\nOrigin: http://127.0.0.1:8751\r\n"),
            (200, b"print(42)"))

    def test_missing_length_rejected(self):
        self.assertEqual(request("POST", "/api/run/python", b"",
            b"X-FlowStudio-Intent: run\r\n")[0], 411)

    def test_duplicate_origin_rejected(self):
        self.assertEqual(request("POST", "/api/run/python", b"x",
            b"Content-Length: 1\r\nX-FlowStudio-Intent: run\r\n"
            b"Origin: http://127.0.0.1:8751\r\nOrigin: http://evil.invalid\r\n")[0], 400)

    def test_duplicate_intent_rejected(self):
        self.assertEqual(request("POST", "/api/run/python", b"x",
            b"Content-Length: 1\r\nX-FlowStudio-Intent: run\r\n"
            b"X-FlowStudio-Intent: run\r\n")[0], 400)

    def test_localhost_origin(self):
        self.assertEqual(request("POST", "/api/run/python", b"x",
            b"Content-Length: 1\r\nX-FlowStudio-Intent: run\r\n"
            b"Origin: http://localhost:8751\r\n"), (200, b"x"))

    def test_duplicate_content_length_rejected(self):
        self.assertEqual(request("POST", "/api/run/python", b"x",
            b"Content-Length: 1\r\nContent-Length: 1\r\nX-FlowStudio-Intent: run\r\n")[0], 400)

    def test_transfer_encoding_rejected(self):
        self.assertEqual(request("POST", "/api/run/python", b"x",
            b"Content-Length: 1\r\nTransfer-Encoding: chunked\r\nX-FlowStudio-Intent: run\r\n")[0], 400)

    def test_oversized_rejected(self):
        self.assertEqual(request("POST", "/api/run/python", b"",
            b"Content-Length: 131073\r\nX-FlowStudio-Intent: run\r\n")[0], 413)

    def test_nul_rejected(self):
        self.assertEqual(request("POST", "/api/run/python", b"x\x00y",
            b"Content-Length: 3\r\nX-FlowStudio-Intent: run\r\n")[0], 400)


if __name__ == "__main__":
    unittest.main(verbosity=2)
