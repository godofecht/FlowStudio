"""Real persistent R/Python HTTP acceptance for exact Flow determinant fixtures.

The same seeded 2x2--4x4 matrices exercised by native Flow are solved by
base R and independently checked inside the production Python kernel with
exact permutation/Cramer arithmetic. No mocked runtimes or numerical outputs.
"""
from __future__ import annotations

import json
import math

from determinant_oracle import determinant_bareiss, matrix_cases

MARKER = "FLOWSTUDIO_MATRIX_INTEROP_V1 "
MAX_SOURCE_BYTES = 128 * 1024
MAX_FRAME_BYTES = 24 * 1024


def _r_program(cases):
    lines = ["flowstudio_matrix_interop_count <- 0L"]
    for index, (_, rows, expected) in enumerate(cases):
        n = len(rows)
        flat = ",".join(str(v) for row in rows for v in row)
        rhs = ",".join(str(v) for v in (1, -2, 3, -4)[:n])
        lines.extend((
            f"flowstudio_matrix_A <- matrix(c({flat}), nrow={n}, byrow=TRUE)",
            f"flowstudio_matrix_b <- c({rhs})",
            "flowstudio_matrix_rank <- qr(flowstudio_matrix_A, tol=1e-12)$rank",
            "flowstudio_matrix_det <- det(flowstudio_matrix_A)",
            f"if (abs(flowstudio_matrix_det - ({expected})) > 1e-7) stop('R determinant mismatch')",
            f"if (flowstudio_matrix_rank != {n if expected else n - 1}) stop('R rank mismatch')",
            "flowstudio_matrix_x <- if (flowstudio_matrix_rank == nrow(flowstudio_matrix_A)) "
            "solve(flowstudio_matrix_A, flowstudio_matrix_b) "
            "else rep(0, nrow(flowstudio_matrix_A))",
            f"cat('{MARKER}{index},', sprintf('%.17g', flowstudio_matrix_det), ',', "
            "flowstudio_matrix_rank, ',', "
            "paste(sprintf('%.17g', flowstudio_matrix_x), collapse=','), '\\n', sep='')",
            "flowstudio_matrix_interop_count <- flowstudio_matrix_interop_count + 1L",
        ))
    lines.append(f"stopifnot(flowstudio_matrix_interop_count == {len(cases)})")
    source = "\n".join(lines)
    assert len(source.encode("utf-8")) < MAX_SOURCE_BYTES
    return source


def _python_verifier(cases, observed, corrupt=False):
    payload = json.dumps({"cases": [[list(row) for row in rows] for _, rows, _ in cases],
                          "observed": observed}, allow_nan=False, separators=(",", ":"))
    assert len(payload.encode("utf-8")) < MAX_FRAME_BYTES
    # The Python kernel recomputes all determinants using permutations and
    # every nonsingular solution using exact Cramer's rule, not R's QR/solve
    # or the host's Bareiss elimination.
    source = (
        "import json, math, itertools, fractions\n"
        "flowstudio_matrix_payload = json.loads(" + repr(payload) + ")\n"
        "def flowstudio_matrix_det_exact(a):\n"
        "    n = len(a)\n"
        "    total = 0\n"
        "    for p in itertools.permutations(range(n)):\n"
        "        inv = sum(p[i] > p[j] for i in range(n) for j in range(i+1,n))\n"
        "        term = math.prod(a[i][p[i]] for i in range(n))\n"
        "        total += -term if inv % 2 else term\n"
        "    return total\n"
        "assert len(flowstudio_matrix_payload['cases']) == 43\n"
        "assert len(flowstudio_matrix_payload['observed']) == 43\n"
        "for a, record in zip(flowstudio_matrix_payload['cases'], flowstudio_matrix_payload['observed']):\n"
        "    n = len(a)\n"
        "    d = flowstudio_matrix_det_exact(a)\n"
        "    assert abs(record[0] - d) < 1e-7, 'matrix determinant mismatch'\n"
        "    assert record[1] == (n if d else n-1), 'matrix rank mismatch'\n"
        "    assert len(record[2]) == n\n"
        "    if d:\n"
        "        b = (1,-2,3,-4)[:n]\n"
        "        for j in range(n):\n"
        "            aj = [[b[i] if k == j else a[i][k] for k in range(n)] for i in range(n)]\n"
        "            exact = fractions.Fraction(flowstudio_matrix_det_exact(aj), d)\n"
        "            assert abs(record[2][j] - float(exact)) < 1e-9, 'matrix solve mismatch'\n"
        "    else:\n"
        "        assert all(x == 0 for x in record[2]), 'singular solve not rejected'\n"
        "print('matrix-interoperability-oracle-ok')\n"
    )
    assert len(source.encode("utf-8")) < MAX_SOURCE_BYTES
    if corrupt:
        altered = json.loads(payload)
        index = next(i for i, (_, _, expected) in enumerate(cases) if expected != 0)
        altered["observed"][index][2][0] += 0.5
        return _python_verifier(cases, altered["observed"])
    return source


def verify_matrix_interop(request, headers: dict[str, str]) -> None:
    cases = matrix_cases()
    assert len(cases) == 43
    for _, rows, expected in cases:
        assert determinant_bareiss(rows) == expected
    source = _r_program(cases)
    status, body = request("POST", "/api/run/r", source, headers)
    assert status == 200, ("real R matrix solve", status, body[:500])
    assert len(body.encode("utf-8")) < MAX_FRAME_BYTES
    frames = [line[len(MARKER):] for line in body.splitlines()
              if line.startswith(MARKER)]
    assert len(frames) == len(cases), ("R matrix frame count", len(frames))
    observed = []
    for index, (line, (_, rows, _)) in enumerate(zip(frames, cases)):
        values = line.split(",")
        assert len(values) == len(rows) + 3 and int(values[0]) == index
        determinant = float(values[1])
        rank = int(values[2])
        solution = [float(value) for value in values[3:]]
        assert math.isfinite(determinant) and all(map(math.isfinite, solution))
        observed.append([determinant, rank, solution])

    def check_python(corrupt=False):
        python_source = _python_verifier(cases, observed, corrupt=corrupt)
        return request("POST", "/api/run/python", python_source, headers)

    status, body = check_python()
    assert status == 200 and "matrix-interoperability-oracle-ok" in body, (
        "real Python exact permutation/Cramer oracle", status, body[:500])
    status, body = check_python(corrupt=True)
    assert status == 422 and "matrix solve mismatch" in body, (
        "real Python corrupted solve rejection", status, body[:500])
    status, body = request("POST", "/api/run/r",
                           "stopifnot(flowstudio_matrix_interop_count == 43L); "
                           "cat('matrix-r-persistent-ok\\n')", headers)
    assert status == 200 and "matrix-r-persistent-ok" in body, (
        "persistent R matrix state", status, body[:500])
    status, body = check_python()
    assert status == 200 and "matrix-interoperability-oracle-ok" in body, (
        "Python recovery after rejected numerical result", status, body[:500])
    print("PASS: 43 seeded native Flow matrix fixtures cross-checked through "
          "real persistent R solve and Python exact Cramer HTTP; 422 negative")
