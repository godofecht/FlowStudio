"""Real native Flow HTTP plus persistent Python/R streaming-statistics acceptance."""
from __future__ import annotations

from fractions import Fraction
from pathlib import Path

from test_parallel_streaming_stats import COUNT, exact_summary, samples

ROOT = Path(__file__).resolve().parents[1]


def _frame(output: str, marker: str) -> tuple[int, float, float, float, float]:
    lines = [line.strip() for line in output.splitlines()]
    matches = [line for line in lines if line.startswith(marker + " ")]
    assert len(matches) == 1, (marker, output[-500:])
    tokens = matches[0].split()
    assert len(tokens) == 6 and tokens[0] == marker, tokens
    values = (int(tokens[1]), *map(float, tokens[2:]))
    assert values[0] == COUNT, values
    return values


def _compare(actual: tuple[int, float, float, float, float], expected):
    count, mean, m2, minimum, maximum = expected
    assert actual[0] == count
    assert abs(actual[1] - float(mean)) < 0.0002, (actual, mean)
    assert abs(actual[2] - float(m2 / (count - 1))) < 0.002, (actual, m2)
    assert abs(actual[3] - float(minimum)) < 0.0002
    assert abs(actual[4] - float(maximum)) < 0.0002


def verify_parallel_streaming_stats(request, headers: dict[str, str]) -> None:
    """Compile and execute the real checked-in Flow source and cross-check R/Python."""
    module = (ROOT / "src/stats.flow").read_text(encoding="utf-8")
    smoke = (ROOT / "src/stats_smoke.flow").read_text(encoding="utf-8")
    # The production HTTP compiler receives a single source buffer, unlike
    # the file-based compiler's relative module import. Inline exactly that
    # module; strip only its export keyword and the smoke's import directive.
    inline_module = "\n".join(line.removeprefix("export ")
                              for line in module.splitlines())
    inline_smoke = "\n".join(line for line in smoke.splitlines()
                             if not line.startswith("import .stats "))
    source = inline_module + "\n" + inline_smoke + "\n"
    assert len(source.encode("utf-8")) < 128 * 1024

    status, output = request("POST", "/api/check/flow", source, headers)
    assert status == 200, ("parallel Flow check", status, output[-500:])
    status, output = request("POST", "/api/run/flow", source, headers)
    assert status == 200, ("parallel Flow run", status, output[-500:])
    lines = [line.strip() for line in output.splitlines()]
    assert lines.count("FLOWSTUDIO_STREAM_STATS_V1 1024") == 1
    at = lines.index("FLOWSTUDIO_STREAM_STATS_V1 1024")
    assert lines[at + 2] == "FLOWSTUDIO_STREAM_STATS_END", lines[at:at+3]
    native = _frame(lines[at + 1], "S")
    expected = exact_summary(samples())
    _compare(native, expected)

    # Compiles successfully, but the wrong numerical oracle must be rejected
    # by the native executable, not by a Python test-only assertion.
    corrupted = source.replace("82.06557894918343", "83.06557894918343")
    assert corrupted != source
    status, output = request("POST", "/api/check/flow", corrupted, headers)
    assert status == 200, ("corrupted Flow check", status, output[-500:])
    status, output = request("POST", "/api/run/flow", corrupted, headers)
    assert status == 422, ("corrupted Flow numerical oracle", status, output[-500:])

    python_source = (
        "import statistics as _fs_statistics\n"
        "_fs_values = [1000000000 + ((i*37+19)%251)/8 for i in range(1024)]\n"
        "print('FLOWSTUDIO_STREAM_STATS_PY', len(_fs_values), "
        "format(_fs_statistics.mean(_fs_values), '.17g'), "
        "format(_fs_statistics.variance(_fs_values), '.17g'), "
        "format(min(_fs_values), '.17g'), format(max(_fs_values), '.17g'))\n"
        "del _fs_values, _fs_statistics\n"
    )
    assert len(python_source.encode()) < 2048
    status, output = request("POST", "/api/run/python", python_source, headers)
    assert status == 200, ("persistent Python stats", status, output[-500:])
    python_result = _frame(output, "FLOWSTUDIO_STREAM_STATS_PY")
    _compare(python_result, expected)

    r_source = (
        "local({ x <- 1000000000 + (((0:1023)*37+19) %% 251)/8; "
        "cat('FLOWSTUDIO_STREAM_STATS_R', length(x), "
        "sprintf('%.17g',mean(x)), sprintf('%.17g',var(x)), "
        "sprintf('%.17g',min(x)), sprintf('%.17g',max(x)), '\\n') })"
    )
    assert len(r_source.encode()) < 1024
    status, output = request("POST", "/api/run/r", r_source, headers)
    assert status == 200, ("persistent base R stats", status, output[-500:])
    r_result = _frame(output, "FLOWSTUDIO_STREAM_STATS_R")
    _compare(r_result, expected)
    assert abs(native[2] - python_result[2]) < 0.002
    assert abs(native[2] - r_result[2]) < 0.002

    # Failed R/Python numerical assertions must not kill their real kernels.
    status, _ = request("POST", "/api/run/r",
                        "stopifnot(abs(var(1:4)-9.7)<0.001)", headers)
    assert status == 422, status
    status, output = request("POST", "/api/run/r", "cat(42)", headers)
    assert status == 200 and output.strip() == "42", (status, output)
    status, _ = request("POST", "/api/run/python",
                        "assert abs(1.0 - 9.7) < 0.001", headers)
    assert status == 422, status
    status, output = request("POST", "/api/run/python", "print(42)", headers)
    assert status == 200 and output.strip() == "42", (status, output)
