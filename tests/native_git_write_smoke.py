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

    # Unstage a tracked modification without discarding the edited file, while
    # leaving unrelated staged paths untouched. Include literal metacharacters.
    tracked = HERE / "a [1].flow"
    tracked.write_text("function main() -> i32 { return 42 }\n", encoding="utf-8")
    new_path = HERE / "new [2].flow"
    new_path.write_text("new untracked content\n", encoding="utf-8")
    assert post("/api/git/stage", "a [1].flow")[0] == 200
    assert post("/api/git/stage", "new [2].flow")[0] == 200
    assert git("diff", "--cached", "--name-only").splitlines() == ["a [1].flow", "new [2].flow"]
    status, output = post("/api/git/unstage", "a [1].flow")
    assert status == 200 and "unstaged" in output, (status, output)
    assert tracked.read_text(encoding="utf-8").endswith("return 42 }\n")
    assert git("diff", "--cached", "--name-only").strip() == "new [2].flow"
    assert "a [1].flow" in git("diff", "--name-only")
    assert post("/api/git/unstage", "*.flow")[0] == 422
    assert post("/api/git/unstage", "../outside.flow")[0] == 422
    assert post("/api/git/unstage", ".")[0] == 400
    assert post("/api/git/unstage", "x" * 513)[0] == 400
    assert post("/api/git/unstage", "a [1].flow", "http://attacker.invalid")[0] == 404
    assert git("diff", "--cached", "--name-only").strip() == "new [2].flow"
    status, output = post("/api/git/unstage", "new [2].flow")
    assert status == 200, (status, output)
    assert "new [2].flow" in git("status", "--short")
    assert git("diff", "--cached", "--name-only").strip() == ""
    assert new_path.read_text(encoding="utf-8") == "new untracked content\n"

    assert post("/api/git/commit", "Nothing staged")[0] == 422
    assert post("/api/git/commit", "")[0] == 400
    assert post("/api/git/stage", "other.flow", "http://attacker.invalid")[0] == 404
    assert post("/api/git/commit", "malicious", "http://attacker.invalid")[0] == 404
    # Real branch operations run through the Flow-owned HTTP server, not a
    # test double. Switching must never carry dirty or untracked changes.
    status, branches = post("/api/git/branches", "")
    assert status == 200 and "*" in branches, (status, branches)
    assert post("/api/git/branch/create", "feature/native")[0] == 200
    assert "feature/native" in post("/api/git/branches", "")[1]
    assert post("/api/git/branch/create", "feature/native")[0] == 422
    assert post("/api/git/branch/create", "-bad")[0] == 422
    assert post("/api/git/branch/create", "")[0] == 400
    assert post("/api/git/branch/create", "x" * 129)[0] == 400
    assert post("/api/git/branch/create", "feature/attack", "http://attacker.invalid")[0] == 404
    status, output = post("/api/git/branch/switch", "feature/native")
    assert status == 409 and "working-tree" in output, (status, output)
    git("add", "-A")
    git("-c", "core.hooksPath=/dev/null", "commit", "-m", "Clean fixture before branch switch")
    assert git("status", "--porcelain") == ""
    status, output = post("/api/git/branch/switch", "feature/native")
    assert status == 200, (status, output)
    assert git("symbolic-ref", "--short", "HEAD").strip() == "feature/native"
    assert post("/api/git/branch/switch", "does-not-exist")[0] == 422
    assert post("/api/git/branch/switch", "feature/native", "http://attacker.invalid")[0] == 404
    assert git("symbolic-ref", "--short", "HEAD").strip() == "feature/native"
    print("PASS: live Flow Git stage, unstage, commit, branch list/create/switch, dirty-tree refusal, hooks and origin gate")


if __name__ == "__main__":
    main()
