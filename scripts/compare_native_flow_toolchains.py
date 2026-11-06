#!/usr/bin/env python3
"""Differentially execute checked-in native Flow programs with two real toolchains.

Example:
 python3 scripts/compare_native_flow_toolchains.py \
   --baseline .flow-toolchain/flow --candidate /opt/flow-new/flow \
   src/math_native_smoke.flow

No emulation: each fixture is executed by the supplied Flow binary.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import resource
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time


def execute(binary: Path, fixture: Path, root: Path, timeout: float, limit: int):
    # A temporary regular file prevents unbounded captured-output RAM usage.
    with tempfile.TemporaryFile() as output:
        # Bound child output on disk, not merely the bytes read afterward.
        def restrict_output():
            resource.setrlimit(resource.RLIMIT_FSIZE, (limit + 1, limit + 1))

        start = time.monotonic()
        process = subprocess.Popen(
            [str(binary), "run", str(fixture)],
            cwd=root,
            stdin=subprocess.DEVNULL,
            stdout=output,
            stderr=subprocess.STDOUT,
            start_new_session=True,
            preexec_fn=restrict_output,
        )
        timed_out = False
        try:
            returncode = process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            timed_out = True
            os.killpg(process.pid, signal.SIGKILL)
            returncode = process.wait()
        elapsed = time.monotonic() - start
        size = output.seek(0, os.SEEK_END)
        output.seek(0)
        digest = hashlib.sha256()
        remaining = limit + 1
        while remaining:
            chunk = output.read(min(65536, remaining))
            if not chunk:
                break
            digest.update(chunk)
            remaining -= len(chunk)
        return {
            "exit_code": returncode,
            "timed_out": timed_out,
            "output_bytes": size,
            "output_sha256": digest.hexdigest() if size <= limit else None,
            "output_over_limit": size > limit or returncode == -signal.SIGXFSZ,
            "elapsed_seconds": round(elapsed, 3),
        }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", type=Path, required=True)
    parser.add_argument("--candidate", type=Path, required=True)
    parser.add_argument("--timeout", type=float, default=60.0)
    parser.add_argument("--max-output-bytes", type=int, default=1048576)
    parser.add_argument("fixtures", nargs="+", type=Path)
    args = parser.parse_args()
    if not 0 < args.timeout <= 300 or not 0 < args.max_output_bytes <= 16777216:
        parser.error("timeout must be in (0, 300] and output budget in (0, 16777216]")
    root = Path(__file__).resolve().parents[1]
    binaries = [args.baseline.resolve(), args.candidate.resolve()]
    for binary in binaries:
        if not binary.is_file() or not os.access(binary, os.X_OK):
            parser.error(f"Flow executable missing or not executable: {binary}")
    fixtures = [path.resolve() for path in args.fixtures]
    for fixture in fixtures:
        if not fixture.is_file() or fixture.suffix != ".flow":
            parser.error(f"Expected an existing .flow fixture: {fixture}")
        if not fixture.is_relative_to(root):
            parser.error(f"Fixture must be checked in under repository root: {fixture}")
    failed = False
    for fixture in fixtures:
        baseline = execute(binaries[0], fixture, root, args.timeout, args.max_output_bytes)
        candidate = execute(binaries[1], fixture, root, args.timeout, args.max_output_bytes)
        passed = (
            baseline["exit_code"] == candidate["exit_code"] == 0
            and not baseline["timed_out"] and not candidate["timed_out"]
            and not baseline["output_over_limit"] and not candidate["output_over_limit"]
            and baseline["output_sha256"] == candidate["output_sha256"]
        )
        failed |= not passed
        print(json.dumps({
            "fixture": str(fixture.relative_to(root)),
            "status": "passed" if passed else "failed",
            "baseline": baseline,
            "candidate": candidate,
        }, sort_keys=True), flush=True)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
