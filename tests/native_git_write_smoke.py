#!/usr/bin/env python3
"""Real Flow-owned Git HTTP write acceptance, run in an isolated temporary Git repo.

The native FlowStudio server must already be running with cwd set to this
temporary directory. Never run these write assertions in the source checkout.
"""
from __future__ import annotations

from pathlib import Path
import subprocess
import urllib.error
import urllib.request

ROOT = "http://127.0.0.1:8751"
HERE = Path.cwd()


def git(*args: str) -> str:
    result = subprocess.run(["git", *args], cwd=HERE, text=True,
                            capture_output=True, timeout=10, check=True)
    return result.stdout


def post(route: str, value: str, origin: str | None = None) -> tuple[int, str]:
    headers = {"X-FlowStudio-Intent": "run", "Content-Type": "text/plain; charset=utf-8"}
    if origin is not None:
        headers["Origin"] = origin
    request = urllib.request.Request(ROOT + route, data=value.encode("utf-8"),
                                     method="POST", headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return response.status, response.read().decode("utf-8")
    except urllib.error.HTTPError as error:
        return error.code, error.read().decode("utf-8")


def main() -> None:
    git("init", "-q")
    git("config", "user.name", "FlowStudio Acceptance")
    git("config", "user.email", "flowstudio-test@example.invalid")
    (HERE / "a [1].flow").write_text("function main() -> i32 { return 0 }\n", encoding="utf-8")
    (HERE / "other.flow").write_text("not staged\n", encoding="utf-8")

    # A malicious pre-commit hook must not run through the native endpoint.
    hook = HERE / ".git/hooks/pre-commit"
    hook.write_text("#!/bin/sh\nexit 19\n", encoding="utf-8")
    hook.chmod(0o755)

    assert post("/api/git/stage", "a [1].flow")[0] == 200
    assert git("diff", "--cached", "--name-only").strip() == "a [1].flow"
    status, diff = post("/api/git/diff/staged", "")
    assert status == 200 and "a [1].flow" in diff and "function main()" in diff
    assert post("/api/git/stage", "*.flow")[0] == 422  # literal path, never a glob
    assert post("/api/git/stage", "../outside.flow")[0] == 422
    assert post("/api/git/stage", ".")[0] == 400
    assert post("/api/git/stage", "x" * 513)[0] == 400
    assert git("diff", "--cached", "--name-only").strip() == "a [1].flow"

    status, output = post("/api/git/commit", "Native Git HTTP acceptance")
    assert status == 200, (status, output)
    assert git("log", "-1", "--format=%s").strip() == "Native Git HTTP acceptance"
    assert git("show", "--pretty=format:", "--name-only", "HEAD").strip() == "a [1].flow"
    assert "other.flow" in git("status", "--short")
    assert post("/api/git/commit", "Nothing staged")[0] == 422
    assert post("/api/git/commit", "")[0] == 400
    assert post("/api/git/stage", "other.flow", "http://attacker.invalid")[0] == 404
    assert post("/api/git/commit", "malicious", "http://attacker.invalid")[0] == 404
    print("PASS: live Flow Git stage, staged diff, commit, literal paths, hook isolation and origin gate")


if __name__ == "__main__":
    main()
