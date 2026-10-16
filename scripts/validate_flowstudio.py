#!/usr/bin/env python3
"""Run local FlowStudio verification without claiming RStudio feature parity.

This script does not modify CI, install dependencies, or expose a remote server.
It runs the existing repository tests and optionally launches the real Flow
application for live HTTP verification. Missing tools are recorded as BLOCKED,
not as passing tests. Run from any directory.
"""
from __future__ import annotations

import argparse
import json
import os
import platform
import shutil
import signal
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HOST, PORT = "127.0.0.1", 8751
TEST_TIMEOUT = 90


def result(name: str, state: str, detail: str = "", **extra: object) -> dict:
    return {"name": name, "state": state, "detail": detail, **extra}


def execute(name: str, argv: list[str], timeout: int = TEST_TIMEOUT) -> dict:
    started = time.monotonic()
    try:
        proc = subprocess.run(argv, cwd=ROOT, text=True, errors="replace",
                              capture_output=True, timeout=timeout, check=False)
    except FileNotFoundError as exc:
        return result(name, "blocked", str(exc), command=argv)
    except subprocess.TimeoutExpired as exc:
        return result(name, "failed", f"Timed out after {timeout}s", command=argv,
                      seconds=round(time.monotonic() - started, 3))
    return result(name, "passed" if proc.returncode == 0 else "failed",
                  f"exit {proc.returncode}", command=argv, exit_code=proc.returncode,
                  seconds=round(time.monotonic() - started, 3),
                  stdout=proc.stdout[-2500:], stderr=proc.stderr[-2500:])


def require_file(path: str) -> bool:
    return (ROOT / path).is_file()


def local_suites(selection: str) -> list[dict]:
    checks: list[dict] = []
    cases = {
        "kernel": ("tests/kernel_bridge.test.py", [sys.executable, "tests/kernel_bridge.test.py", "-v"]),
        "contracts": ("tests/integration_contract.test.py", [sys.executable, "tests/integration_contract.test.py", "-v"]),
        "transport": ("tests/transport_smoke.py", [sys.executable, "tests/transport_smoke.py"]),
    }
    for name, (path, command) in cases.items():
        if selection not in ("all", name):
            continue
        checks.append(execute(name, command) if require_file(path)
                      else result(name, "blocked", f"Missing repository test: {path}"))
    if selection in ("all", "browser"):
        tests = sorted(str(path.relative_to(ROOT)) for path in (ROOT / "tests").glob("*.test.js"))
        if not tests:
            checks.append(result("browser", "blocked", "No Node test files found"))
        elif not shutil.which("node"):
            checks.append(result("browser", "blocked", "Node.js is not installed"))
        else:
            checks.append(execute("browser", ["node", "--test", *tests]))
    return checks


def is_port_busy() -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.3)
        return sock.connect_ex((HOST, PORT)) == 0


def await_server(proc: subprocess.Popen, seconds: float = 10.0) -> tuple[bool, str]:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if proc.poll() is not None:
            return False, f"FlowStudio exited before readiness (exit {proc.returncode})"
        try:
            with urllib.request.urlopen(f"http://{HOST}:{PORT}/health", timeout=0.5) as response:
                if response.status == 200 and b"FlowStudio ready" in response.read():
                    return True, "Health endpoint returned expected response"
        except (OSError, ValueError):
            pass
        time.sleep(0.1)
    return False, "FlowStudio health endpoint did not become ready within 10s"


def native_suite() -> list[dict]:
    if not shutil.which("flow"):
        return [result("native_build", "blocked", "Flow compiler unavailable; native compilation not attempted")]
    if not shutil.which("cc"):
        return [result("native_build", "blocked", "C compiler unavailable")]
    if not require_file("scripts/build.sh"):
        return [result("native_build", "blocked", "Missing scripts/build.sh")]
    build = execute("native_build", ["sh", "scripts/build.sh"], timeout=180)
    checks = [build]
    if build["state"] != "passed":
        return checks
    if not (ROOT / "build/flowstudio").is_file():
        checks.append(result("native_executable", "failed", "Build succeeded but executable is missing"))
        return checks
    if is_port_busy():
        checks.append(result("live_http", "blocked", f"Port {PORT} is already occupied; refusing to use or stop existing service"))
        return checks
    log_path = ROOT / "build/validation-server.log"
    with log_path.open("w", encoding="utf-8") as log:
        proc = subprocess.Popen([str(ROOT / "build/flowstudio")], cwd=ROOT,
                                stdout=log, stderr=subprocess.STDOUT,
                                start_new_session=True)
        try:
            ready, detail = await_server(proc)
            checks.append(result("server_startup", "passed" if ready else "failed", detail))
            if ready:
                for name, path in (("live_http", "tests/http_smoke.py"),
                                   ("persistent_http", "tests/http_kernels_smoke.py")):
                    checks.append(execute(name, [sys.executable, path]) if require_file(path)
                                  else result(name, "blocked", f"Missing {path}"))
        finally:
            if proc.poll() is None:
                os.killpg(proc.pid, signal.SIGTERM)
                try:
                    proc.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    os.killpg(proc.pid, signal.SIGKILL)
                    proc.wait(timeout=3)
    if not shutil.which("R"):
        checks.append(result("r_runtime", "blocked", "R not installed; R execution not verified"))
    return checks


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--suite", choices=("all", "kernel", "contracts", "transport", "browser"), default="all")
    parser.add_argument("--native", action="store_true", help="Build and launch FlowStudio for live HTTP tests")
    parser.add_argument("--output", type=Path, help="Write machine-readable report to this JSON path")
    args = parser.parse_args(argv)
    checks = local_suites(args.suite)
    if args.native:
        checks.extend(native_suite())
    report = {
        "project": "FlowStudio", "parity_verified": False,
        "platform": platform.platform(), "architecture": platform.machine(),
        "python": sys.version.split()[0], "flow_available": bool(shutil.which("flow")),
        "r_available": bool(shutil.which("R")), "checks": checks,
    }
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    for item in checks:
        print(f"{item['state'].upper():7} {item['name']}: {item['detail']}")
    print("RStudio parity: NOT VERIFIED")
    return 1 if any(x["state"] == "failed" for x in checks) else (2 if any(x["state"] == "blocked" for x in checks) else 0)


if __name__ == "__main__":
    raise SystemExit(main())
