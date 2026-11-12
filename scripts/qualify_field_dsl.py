#!/usr/bin/env python3
"""Strict production Field DSL qualification gate (never silently skips).

Usage: FLOW_FIELD_COMPILER=/absolute/path/to/flow python3 scripts/qualify_field_dsl.py
Run from the FlowStudio repository root. This script does not install a compiler.
"""
import os
import shutil
import subprocess
import sys
from pathlib import Path


def main():
    root = Path(__file__).resolve().parent.parent
    compiler = os.environ.get("FLOW_FIELD_COMPILER") or shutil.which("flow")
    if not compiler:
        print("UNEXECUTED: no Flow compiler; Field DSL qualification FAILED CLOSED", file=sys.stderr)
        return 2
    path = Path(compiler).expanduser().resolve()
    if not path.is_file() or not os.access(path, os.X_OK):
        print(f"UNEXECUTED: compiler is not an executable file: {path}", file=sys.stderr)
        return 2
    env = os.environ.copy()
    env["FLOW_FIELD_COMPILER"] = str(path)
    command = [sys.executable, "-m", "unittest", "discover", "-s", "tests",
               "-p", "test_field_dsl_compiler_integration.py", "-v"]
    try:
        completed = subprocess.run(command, cwd=root, env=env, timeout=90, check=False)
    except subprocess.TimeoutExpired:
        print("FAILED: Field DSL qualification exceeded 90 seconds", file=sys.stderr)
        return 124
    if completed.returncode:
        print(f"FAILED: production Field DSL qualification exited {completed.returncode}", file=sys.stderr)
        return completed.returncode
    print("PASSED: production compiler Field DSL numerical qualification")
    return 0


if __name__ == "__main__":
    sys.exit(main())
