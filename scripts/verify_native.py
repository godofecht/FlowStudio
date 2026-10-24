#!/usr/bin/env python3
"""Fail-closed FlowStudio native build and live-HTTP acceptance gate.

Run from any directory: python3 scripts/verify_native.py
This does not substitute a mock router for the actual Flow executable.
"""
from __future__ import annotations

import argparse
import shutil
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request


class VerificationError(RuntimeError):
    pass


def _command(argv: list[str], cwd: Path, timeout: int) -> subprocess.CompletedProcess[str]:
    # A build or test may launch descendants; a timeout must stop its group.
    proc = subprocess.Popen(argv, cwd=cwd, text=True, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, start_new_session=True)
    try:
        stdout, stderr = proc.communicate(timeout=timeout)
    except subprocess.TimeoutExpired as exc:
        _stop_process_group(proc)
        proc.communicate()
        raise VerificationError(f"Timed out after {timeout}s: {' '.join(argv)}") from exc
    return subprocess.CompletedProcess(argv, proc.returncode, stdout, stderr)


def _free_port(port: int) -> None:
    # Do not accidentally test somebody else's FlowStudio instance.
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        try:
            sock.bind(("127.0.0.1", port))
        except OSError as exc:
            raise VerificationError(f"Port {port} is already in use; stop that server first") from exc


def _wait_health(proc: subprocess.Popen[bytes], port: int, seconds: float) -> None:
    url = f"http://127.0.0.1:{port}/health"
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if proc.poll() is not None:
            raise VerificationError(f"Native server exited before readiness (code {proc.returncode})")
        try:
            with urllib.request.urlopen(url, timeout=0.5) as reply:
                if reply.status == 200 and reply.read(128) == b"FlowStudio ready":
                    return
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError):
            pass
        time.sleep(0.1)
    raise VerificationError(f"Native server did not become healthy within {seconds}s")


def _stop_process_group(proc: subprocess.Popen[bytes]) -> None:
    # Descendants may survive after the group leader exits.
    try:
        os.killpg(proc.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    try:
        proc.wait(timeout=3)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        proc.wait(timeout=3)


def verify(root: Path, port: int = 8751, build_timeout: int = 180,
           startup_timeout: float = 15, require_r: bool = False) -> None:
    root = root.resolve()
    build = root / "scripts/build.sh"
    binary = root / "build/flowstudio"
    smoke = root / "tests/http_smoke.py"
    if not build.is_file() or not smoke.is_file():
        raise VerificationError("Missing scripts/build.sh or tests/http_smoke.py")

    if require_r:
        if not shutil.which("Rscript"):
            raise VerificationError("Rscript is required for native R acceptance")
        print("Real R IPC acceptance: tests/test_native_r_session.py", flush=True)
        r_result = _command(
            [sys.executable, "-m", "unittest", "discover", "-s", "tests",
             "-p", "test_native_r_session.py", "-v"], root, 65
        )
        if r_result.stdout:
            print(r_result.stdout, end="", flush=True)
        if r_result.stderr:
            print(r_result.stderr, end="", file=sys.stderr, flush=True)
        if r_result.returncode != 0:
            raise VerificationError("Real R IPC acceptance failed")
        if not shutil.which("node"):
            raise VerificationError("Node.js is required for browser transfer Rscript acceptance")
        print("Real Python/R transfer query acceptance: tests/browser_variable_transfer.test.js", flush=True)
        transfer_result = _command(
            ["node", "--test", str(root / "tests/browser_variable_transfer.test.js")], root, 65
        )
        if transfer_result.stdout:
            print(transfer_result.stdout, end="", flush=True)
        if transfer_result.stderr:
            print(transfer_result.stderr, end="", file=sys.stderr, flush=True)
        if transfer_result.returncode != 0:
            raise VerificationError("Real Python/R transfer query acceptance failed")
        print("Real browser R inspector query acceptance: tests/browser_r_nested_environment.test.js", flush=True)
        inspect_result = _command(
            ["node", "--test", str(root / "tests/browser_r_nested_environment.test.js")], root, 65
        )
        if inspect_result.stdout:
            print(inspect_result.stdout, end="", flush=True)
        if inspect_result.stderr:
            print(inspect_result.stderr, end="", file=sys.stderr, flush=True)
        if inspect_result.returncode != 0:
            raise VerificationError("Real browser R inspector acceptance failed")
    _free_port(port)
    # Never accept a stale executable left by an earlier successful build.
    # Unlinking a symlink here also avoids following an unexpected target.
    if binary.is_symlink() or binary.is_file():
        binary.unlink()
    print(f"Build: sh {build.relative_to(root)}", flush=True)
    built = _command(["sh", str(build)], root, build_timeout)
    if built.stdout:
        print(built.stdout, end="", flush=True)
    if built.stderr:
        print(built.stderr, end="", file=sys.stderr, flush=True)
    if built.returncode != 0:
        raise VerificationError(f"Native build failed with exit code {built.returncode}")
    if not binary.is_file() or not os.access(binary, os.X_OK):
        raise VerificationError("Build reported success without an executable build/flowstudio")

    # Check again after the build; a different process might have acquired the port.
    _free_port(port)
    with tempfile.TemporaryFile(mode="w+t", encoding="utf-8") as server_log:
        proc = subprocess.Popen([str(binary)], cwd=root, stdout=server_log,
                                stderr=subprocess.STDOUT, start_new_session=True)
        try:
            _wait_health(proc, port, startup_timeout)
            print("Live native server: GET /health verified", flush=True)
            smoke_result = _command([sys.executable, str(smoke)], root, 120)
            if smoke_result.stdout:
                print(smoke_result.stdout, end="", flush=True)
            if smoke_result.stderr:
                print(smoke_result.stderr, end="", file=sys.stderr, flush=True)
            if smoke_result.returncode != 0:
                raise VerificationError(f"HTTP smoke failed with exit code {smoke_result.returncode}")
            if proc.poll() is not None:
                raise VerificationError(f"Server exited during HTTP smoke (code {proc.returncode})")
            print("PASS: native build, live health and HTTP smoke", flush=True)
        except BaseException:
            server_log.seek(0)
            print("Native server log:\n" + server_log.read()[-16000:], file=sys.stderr)
            raise
        finally:
            _stop_process_group(proc)

    # A second live server exercises Git mutations in an isolated checkout,
    # never the repository running CI. This is real Git and the real Flow
    # executable, not an HTTP mock or a command-line approximation.
    git_smoke = root / "tests/native_git_write_smoke.py"
    if not git_smoke.is_file() or not shutil.which("git"):
        raise VerificationError("Native Git write acceptance requires git and its fixture script")
    with tempfile.TemporaryDirectory(prefix="flowstudio-git-") as temp:
        fixture = Path(temp)
        shutil.copytree(root / "web", fixture / "web")
        shutil.copytree(root / "docs", fixture / "docs")
        # The preceding server may leave TCP TIME_WAIT sockets. The real
        # listener sets SO_REUSEADDR; a plain probe bind here would be flaky.
        with tempfile.TemporaryFile(mode="w+t", encoding="utf-8") as git_log:
            git_server = subprocess.Popen([str(binary)], cwd=fixture,
                                          stdout=git_log, stderr=subprocess.STDOUT,
                                          start_new_session=True)
            try:
                _wait_health(git_server, port, startup_timeout)
                result = _command([sys.executable, str(git_smoke)], fixture, 65)
                if result.stdout:
                    print(result.stdout, end="", flush=True)
                if result.stderr:
                    print(result.stderr, end="", file=sys.stderr, flush=True)
                if result.returncode != 0:
                    raise VerificationError("Isolated live native Git write acceptance failed")
                if git_server.poll() is not None:
                    raise VerificationError("Git fixture server exited unexpectedly")
            except BaseException:
                git_log.seek(0)
                print("Native Git fixture server log:\\n" + git_log.read()[-16000:],
                      file=sys.stderr)
                raise
            finally:
                _stop_process_group(git_server)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--require-r", action="store_true", help="require real Rscript IPC acceptance")
    args = parser.parse_args()
    try:
        verify(args.root, require_r=args.require_r)
    except VerificationError as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
