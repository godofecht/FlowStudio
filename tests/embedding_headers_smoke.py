#!/usr/bin/env python3
"""Native transport response-header regression for same-origin iframes."""
from __future__ import annotations
import socket
import unittest
from transport_smoke import PORT, TransportTest

def response(host: str = "127.0.0.1:8751") -> bytes:
    req = (f"GET /health HTTP/1.1\r\nHost: {host}\r\n\r\n").encode("ascii")
    with socket.create_connection(("127.0.0.1", PORT), timeout=3) as conn:
        conn.sendall(req)
        conn.shutdown(socket.SHUT_WR)
        chunks = []
        while part := conn.recv(65536):
            chunks.append(part)
    return b"".join(chunks)

class EmbeddingHeadersTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        TransportTest.setUpClass()

    @classmethod
    def tearDownClass(cls):
        TransportTest.tearDownClass()

    def test_same_origin_embedding_only(self):
        head, sep, body = response().partition(b"\r\n\r\n")
        self.assertEqual(sep, b"\r\n\r\n")
        self.assertTrue(head.startswith(b"HTTP/1.1 200 OK\r\n"))
        self.assertEqual(body, b"healthy")
        self.assertIn(b"\r\nX-Frame-Options: SAMEORIGIN\r\n", head + b"\r\n")
        self.assertIn(b"\r\nContent-Security-Policy: frame-ancestors 'self'\r\n", head + b"\r\n")
        self.assertNotIn(b"X-Frame-Options: DENY", head)

    def test_dns_rebinding_rejection_preserved(self):
        raw = response(host="evil.invalid:8751")
        self.assertTrue(raw.startswith(b"HTTP/1.1 403 Forbidden\r\n"))
        self.assertIn(b"X-Frame-Options: SAMEORIGIN\r\n", raw)

if __name__ == "__main__":
    unittest.main(verbosity=2)
