#!/usr/bin/env python3
"""Run a real Flow compiler and compare its complete field arrays to an independent oracle.

Usage: python3 scripts/verify_native_field_arrays.py --flow /path/to/flow
Requires a compiler supporting the upstream Field DSL. No simulated Flow execution.
"""
from __future__ import annotations

import argparse
import math
import os
from pathlib import Path
import resource
import signal
import subprocess
import sys
import tempfile

try:
    from scripts.test_field_multiplier_oracle import step
except ModuleNotFoundError:
    from test_field_multiplier_oracle import step

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "src" / "field_multiplier_differential.flow"
MAX_OUTPUT = 16384


def parse_output(data: bytes) -> list[float]:
    try:
        lines = data.decode("utf-8", errors="strict").splitlines()
    except UnicodeDecodeError as exc:
        raise ValueError("Flow emitted non-UTF-8 output") from exc
    if len(lines) != 17 or lines[-1] != "field-multiplier-ok":
        raise ValueError(f"expected 16 numerical values and success marker, got {len(lines)} lines")
    try:
        values = [float(line) for line in lines[:-1]]
    except ValueError as exc:
        raise ValueError("Flow emitted a non-numerical spatial cell") from exc
    if not all(math.isfinite(x) for x in values):
        raise ValueError("Flow emitted non-finite spatial cells")
    return values


def expected_output() -> list[float]:
    v = [0.5, 1., 1., 1., 1., 1., 1., 1.5]
    q = [0., 0., 0., 1., 0., 0., 0., 0.]
    for _ in range(2):
        v = step(v, 0.3, 0.4, 0.5, 1.5)
        q = step(q, 2., 0.1, 0., 0.)
    return v + q


def run_flow(binary: Path, timeout: float) -> bytes:
    if not binary.is_file() or not os.access(binary, os.X_OK):
        raise ValueError(f"Flow binary not executable: {binary}")
    # File-backed streams avoid unbounded PIPE buffering on compiler errors.
    # RLIMIT_FSIZE applies to both stdout and stderr on Linux/macOS.
    with tempfile.TemporaryFile() as output, tempfile.TemporaryFile() as errors:
        def limit_output() -> None:
            resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_OUTPUT + 1, MAX_OUTPUT + 1))

        process = subprocess.Popen(
            [str(binary), "run", str(FIXTURE)],
            cwd=ROOT, stdin=subprocess.DEVNULL, stdout=output,
            stderr=errors, start_new_session=True, preexec_fn=limit_output,
        )
        try:
            try:
                process.wait(timeout=timeout)
            except subprocess.TimeoutExpired as exc:
                raise ValueError("Flow compiler/runtime timed out") from exc
        finally:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait()
        size = output.seek(0, os.SEEK_END)
        error_size = errors.seek(0, os.SEEK_END)
        if size > MAX_OUTPUT:
            raise ValueError("Flow output exceeded 16 KiB")
        if error_size > MAX_OUTPUT:
            raise ValueError("Flow stderr exceeded 16 KiB")
        if process.returncode != 0:
            errors.seek(0)
            raise ValueError(
                f"Flow returned {process.returncode}: "
                + errors.read(2048).decode("utf-8", errors="replace")
            )
        output.seek(0)
        return output.read()


def verify(actual: list[float], expected: list[float], tolerance: float = 1e-9) -> None:
    if not math.isfinite(tolerance) or tolerance < 0:
        raise ValueError("tolerance must be finite and nonnegative")
    if len(actual) != len(expected):
        raise ValueError("spatial array length mismatch")
    for index, (observed, target) in enumerate(zip(actual, expected)):
        if not math.isfinite(target):
            raise ValueError(f"cell {index}: non-finite independent oracle value")
        if not math.isfinite(observed) or abs(observed - target) > tolerance:
            raise ValueError(
                f"cell {index}: compiler={observed!r}, independent_oracle={target!r}"
            )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--flow", type=Path, required=True)
    parser.add_argument("--timeout", type=float, default=60.0)
    args = parser.parse_args()
    if not math.isfinite(args.timeout) or not 0 < args.timeout <= 300:
        parser.error("timeout must be finite and in (0, 300]")
    try:
        actual = parse_output(run_flow(args.flow.resolve(), args.timeout))
        verify(actual, expected_output())
    except (ValueError, OSError) as exc:
        print(f"field-array-oracle-failed: {exc}", file=sys.stderr)
        return 1
    print("field-array-oracle-passed: 16 real compiler cells, two steps, two coefficients")
    return 0


if __name__ == "__main__":
    sys.exit(main())
