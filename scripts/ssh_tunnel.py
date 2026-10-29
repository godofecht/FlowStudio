#!/usr/bin/env python3
"""Access a *running* remote FlowStudio through authenticated OpenSSH.

FlowStudio remains bound to 127.0.0.1:8751 on the remote host. This helper
never starts a public listener, installs credentials, or runs remote commands.
It does not provide multi-user isolation or authenticate HTTP requests.
"""
from __future__ import annotations

import argparse
from http.client import HTTPConnection
from pathlib import Path
import re
import shutil
import socket
import subprocess
import sys
import time

FLOWSTUDIO_PORT = 8751
LOOPBACK = "127.0.0.1"
HEALTH_BODY = b"FlowStudio ready"
DESTINATION = re.compile(r"^[A-Za-z_][A-Za-z0-9_.-]*@[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$")


def validate_destination(destination: str) -> str:
    """Require an explicit SSH user and a non-option hostname, never a command."""
    if (not DESTINATION.fullmatch(destination) or ".." in destination or
            destination.endswith(".") or "@-" in destination):
        raise ValueError("Destination must be user@hostname (no SSH options or commands).")
    return destination


def validate_port(port: int) -> int:
    if isinstance(port, bool) or not isinstance(port, int) or not 1 <= port <= 65535:
        raise ValueError("SSH port must be between 1 and 65535.")
    return port


def ssh_command(destination: str, *, ssh_port: int = 22,
                identity: str | None = None) -> list[str]:
    """Use OpenSSH's argv interface; the remote command is intentionally absent."""
    destination = validate_destination(destination)
    validate_port(ssh_port)
    command = [
        "ssh", "-N", "-T", "-o", "BatchMode=yes",
        "-o", "StrictHostKeyChecking=yes",
        "-o", "ExitOnForwardFailure=yes",
        "-o", "GatewayPorts=no", "-o", "ForwardAgent=no",
        "-o", "ForwardX11=no", "-o", "PasswordAuthentication=no",
        "-o", "KbdInteractiveAuthentication=no",
        "-o", "ControlMaster=no", "-o", "PermitLocalCommand=no",
        "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=3",
        "-o", "ConnectTimeout=10",
    ]
    if identity is not None:
        key = Path(identity).expanduser()
        if not key.is_file():
            raise ValueError("The specified SSH identity file does not exist.")
        command.extend(["-i", str(key.resolve())])
    command.extend(["-p", str(ssh_port), "-L",
                    f"{LOOPBACK}:{FLOWSTUDIO_PORT}:{LOOPBACK}:{FLOWSTUDIO_PORT}",
                    destination])
    return command


def require_free_local_port(port: int = FLOWSTUDIO_PORT) -> None:
    """Never connect to an unrelated local IDE and claim the tunnel is ready."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        try:
            listener.bind((LOOPBACK, port))
        except OSError as exc:
            raise RuntimeError(f"Local {LOOPBACK}:{port} is occupied; close the local service first.") from exc


def remote_health(port: int = FLOWSTUDIO_PORT) -> bool:
    connection = HTTPConnection(LOOPBACK, port, timeout=0.5)
    try:
        connection.request("GET", "/health", headers={"Host": f"{LOOPBACK}:{port}"})
        reply = connection.getresponse()
        return reply.status == 200 and reply.read(64) == HEALTH_BODY
    except (OSError, TimeoutError):
        return False
    finally:
        connection.close()


def wait_for_tunnel(process: subprocess.Popen, timeout: float = 15.0,
                    port: int = FLOWSTUDIO_PORT) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        exit_code = process.poll()
        if exit_code is not None:
            raise RuntimeError(f"SSH exited before FlowStudio became ready (exit {exit_code}).")
        if remote_health(port) and process.poll() is None:
            return
        time.sleep(0.15)
    raise RuntimeError("SSH tunnel opened no FlowStudio /health endpoint. "
                       "Start ./build/flowstudio on the remote host's loopback port 8751.")


def stop_process(process: subprocess.Popen) -> None:
    if process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


def connect(destination: str, *, ssh_port: int = 22,
            identity: str | None = None, timeout: float = 15.0) -> int:
    command = ssh_command(destination, ssh_port=ssh_port, identity=identity)
    if shutil.which("ssh") is None:
        raise RuntimeError("OpenSSH client is not installed or is absent from PATH.")
    require_free_local_port()
    process = subprocess.Popen(command, stdin=subprocess.DEVNULL)
    try:
        wait_for_tunnel(process, timeout)
        print(f"Remote FlowStudio: http://{LOOPBACK}:{FLOWSTUDIO_PORT}/", flush=True)
        print("Authenticated SSH tunnel active. Press Ctrl+C to disconnect.", flush=True)
        return process.wait()
    except KeyboardInterrupt:
        print("\nDisconnecting SSH tunnel.", flush=True)
        return 0
    finally:
        stop_process(process)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("destination", help="SSH user@hostname of a host running FlowStudio")
    parser.add_argument("--ssh-port", type=int, default=22, metavar="PORT")
    parser.add_argument("--identity", metavar="PRIVATE_KEY")
    parser.add_argument("--timeout", type=float, default=15.0, metavar="SECONDS")
    args = parser.parse_args(argv)
    try:
        if not 1 <= args.timeout <= 120:
            raise ValueError("Health-check timeout must be between 1 and 120 seconds.")
        return connect(args.destination, ssh_port=args.ssh_port,
                       identity=args.identity, timeout=args.timeout)
    except (ValueError, RuntimeError, OSError) as exc:
        print(f"FlowStudio SSH tunnel: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
