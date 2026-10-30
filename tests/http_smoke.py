#!/usr/bin/env python3
"""End-to-end smoke tests for a RUNNING local FlowStudio process.

Start ./build/flowstudio first, then execute:
    python3 tests/http_smoke.py
No external Python dependencies.
"""
from __future__ import annotations

import json
import math
import socket
import shutil
import subprocess
from pathlib import Path
import uuid
import urllib.error
import urllib.request

from spectral_interop_http import verify_spectral_interop

ROOT = "http://127.0.0.1:8751"


def request(method: str, path: str, body: str | None = None,
            headers: dict[str, str] | None = None) -> tuple[int, str]:
    data = None if body is None else body.encode("utf-8")
    req = urllib.request.Request(
        ROOT + path, data=data, method=method, headers=headers or {}
    )
    try:
        with urllib.request.urlopen(req, timeout=80 if path in ("/api/run/flow", "/api/run/flow-mlir", "/api/check/flow", "/api/render/quarto") else 25) as reply:
            return reply.status, reply.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8")


def oversized_body_status() -> int:
    """Exercise header-level 413 without racing an early-close against sendall.

    The Flow transport rejects Content-Length above 128 KiB before reading
    the body. Sending the body as well can cause a TCP reset on macOS while
    urllib is still writing, even when the server correctly returned 413.
    """
    request_headers = (
        b"POST /api/run/python HTTP/1.1\r\n"
        b"Host: 127.0.0.1:8751\r\n"
        b"X-FlowStudio-Intent: run\r\n"
        b"Content-Length: 131073\r\n"
        b"Connection: close\r\n\r\n"
    )
    with socket.create_connection(("127.0.0.1", 8751), timeout=10) as connection:
        connection.sendall(request_headers)
        chunks = []
        while chunk := connection.recv(4096):
            chunks.append(chunk)
    response = b"".join(chunks)
    status_line = response.split(b"\r\n", 1)[0]
    assert status_line.startswith(b"HTTP/1.1 "), status_line
    return int(status_line.split()[1])


def main() -> None:
    status, body = request("GET", "/health")
    assert status == 200 and body == "FlowStudio ready", (status, body)

    status, html = request("GET", "/")
    assert status == 200 and "<title>FlowStudio" in html, (status, html[:100])

    # Fetch full local bundles through the real Flow router. Large bundles must
    # survive text reads and HTTP writes unchanged.
    for asset in ("workbench.js", "workbench.css", "editor.worker.js",
                  "workbench.js.LEGAL.txt", "THIRD_PARTY_LICENSES.txt"):
        status, body = request("GET", "/ui/" + asset)
        expected = (Path(__file__).resolve().parents[1] / "web/ui" / asset).read_text()
        assert status == 200 and body == expected, (asset, status, len(body), len(expected))
    status, _ = request("GET", "/ui/not-allowlisted.js")
    assert status == 404, status

    # Native editor must fetch the same multiline-safe source-cell parser tested
    # by Node; a missing Flow static route silently breaks Run Cell.
    assert '<script src="/source_cells.js"></script>' in html
    status, source_cells = request("GET", "/source_cells.js")
    assert status == 200 and "function scanLine(line, state)" in source_cells, (status, source_cells[:100])

    status, _ = request("POST", "/api/run/python", 'print("bad")')
    assert status == 404, status
    status, _ = request("POST", "/api/check/flow", "function main() -> i32 { return 0 }")
    assert status == 404, status

    status, browser = request("GET", "/app/")
    assert status == 200 and "FlowStudioNativeFlow.run(code)" in browser, (status, browser[:100])
    status, client = request("GET", "/app/native_flow.js")
    assert status == 200 and '"/api/run/flow"' in client, (status, client[:100])
    status, recovery_script = request("GET", "/app/notebook_recovery.js")
    assert status == 200 and "FlowStudioNotebookRecovery" in recovery_script, (status, recovery_script[:100])
    status, search_engine = request("GET", "/app/editor_find.js")
    assert status == 200 and "FlowStudioEditorFind" in search_engine, (status, search_engine[:100])
    status, search_panel = request("GET", "/app/find_panel.js")
    assert status == 200 and "FlowStudioFindPanel" in search_panel, (status, search_panel[:100])
    assert 'id="findQuery"' in browser and 'id="replaceAll"' in browser
    status, transfer_script = request("GET", "/app/variable_transfer.js")
    assert status == 200 and "FlowStudioVariableTransfer" in transfer_script, (status, transfer_script[:100])
    assert 'id="transferVariable"' in browser and 'id="transferDirection"' in browser
    status, session_script = request("GET", "/app/session_snapshot.js")
    assert status == 200 and "FlowStudioSessionSnapshot" in session_script, (status, session_script[:100])
    assert 'id="exportSession"' in browser and 'id="importSession"' in browser
    # The Pyodide environment helper must be available from the real Flow
    # static-asset allowlist as well as GitHub Pages.
    status, capture_helper = request("GET", "/app/environment_capture.py")
    assert status == 200 and "def capture(namespace):" in capture_helper, (status, capture_helper[:100])
    status, _ = request("GET", "/app/not-a-real-asset.js")
    assert status == 404, status

    accepted_headers = {"X-FlowStudio-Intent": "run"}
    # The native mathematical bootstrap runs through the actual Flow 2.0
    # compiler/runtime, not /api/run/mathflow's Python/NumPy frontend.
    native_math_source = (Path(__file__).resolve().parents[1] /
                          "examples/native_math_bootstrap.flow").read_text(encoding="utf-8")
    status, body = request("POST", "/api/check/flow", native_math_source, accepted_headers)
    assert status == 200, ("native mathematical Flow compile", status, body)
    status, body = request("POST", "/api/run/flow", native_math_source, accepted_headers)
    assert status == 200, ("native mathematical Flow execution", status, body)
    # A genuinely coupled three-state native Flow model with a conservative
    # transport generator, independent exact eigenmode values, RK2 refinement,
    # positivity, deterministic replay, rescaling and negative-input assertions.
    # Exit-code assertions are enforced by the actual /api/run/flow transport:
    # any nonzero main() result becomes HTTP 422, never a false positive.
    cyclic_source = (Path(__file__).resolve().parents[1] /
                     "examples/native_cyclic_network.flow").read_text(encoding="utf-8")
    status, body = request("POST", "/api/check/flow", cyclic_source, accepted_headers)
    assert status == 200, ("native cyclic Flow compile", status, body)
    status, body = request("POST", "/api/run/flow", cyclic_source, accepted_headers)
    assert status == 200, ("native cyclic Flow eigenmode acceptance", status, body)
    # Native periodic heat PDE: actual Flow compiler and numerical RK2 run.
    # All 25 numerical and invalid-input assertions are in Flow main().
    heat_native_source = (Path(__file__).resolve().parents[1] /
                          "examples/native_periodic_heat.flow").read_text(encoding="utf-8")
    status, body = request("POST", "/api/check/flow", heat_native_source, accepted_headers)
    assert status == 200, ("native periodic heat compile", status, body)
    status, body = request("POST", "/api/run/flow", heat_native_source, accepted_headers)
    assert status == 200, ("native periodic heat analytic execution", status, body)
    # The same native Flow 2.0 wave PDE runs through the production compiler
    # and HTTP execution route; main() checks analytic modes and invalid input.
    wave_native_source = (Path(__file__).resolve().parents[1] /
                          "examples/native_periodic_wave.flow").read_text(encoding="utf-8")
    status, body = request("POST", "/api/check/flow", wave_native_source, accepted_headers)
    assert status == 200, ("native periodic wave compile", status, body)
    status, body = request("POST", "/api/run/flow", wave_native_source, accepted_headers)
    assert status == 200, ("native periodic wave analytic execution", status, body)
    # Native coupled 2D reaction-diffusion: real Flow compiler and RK2 execution.
    # The .flow main() checks 29 analytic, convergence and invalid-input cases.
    coupled_native_source = (Path(__file__).resolve().parents[1] /
                             "examples/native_coupled_diffusion_2d.flow").read_text(encoding="utf-8")
    status, body = request("POST", "/api/check/flow", coupled_native_source, accepted_headers)
    assert status == 200, ("native coupled diffusion compile", status, body)
    status, body = request("POST", "/api/run/flow", coupled_native_source, accepted_headers)
    assert status == 200, ("native coupled diffusion analytic execution", status, body)
    # Native configurable 2D anisotropic tensor diffusion: real Flow compiler,
    # symmetric mixed derivative, 4x4 and 8x8 analytic Fourier oracles.
    tensor_source = (Path(__file__).resolve().parents[1] /
                     "examples/native_tensor_grid.flow").read_text(encoding="utf-8")
    status, body = request("POST", "/api/check/flow", tensor_source, accepted_headers)
    assert status == 200, ("native tensor grid compile", status, body)
    status, body = request("POST", "/api/run/flow", tensor_source, accepted_headers)
    assert status == 200 and "native-tensor-grid-ok" in body, (
        "native tensor grid analytic execution", status, body)
    # Actual upstream Flow evolution DSL, not a hand-coded ODE or Python
    # interpreter: four coupled states with compiler-generated RK4, checked
    # against a discrete Fourier/Poisson oracle and fourth-order refinement.
    ring_source = (Path(__file__).resolve().parents[1] /
                   "examples/native_evolution_ring.flow").read_text(encoding="utf-8")
    status, body = request("POST", "/api/check/flow", ring_source, accepted_headers)
    assert status == 200, ("native evolution ring compile", status, body)
    status, body = request("POST", "/api/run/flow", ring_source, accepted_headers)
    assert status == 200 and "native-evolution-ring-ok" in body, (
        "native evolution ring RK4 analytic execution", status, body)
    # Six-state nonlinear two-cell SIR reaction-diffusion in upstream Flow.
    # All numerical, exact-limit, symmetry, conservation and invalid-input
    # assertions run in the native compiler-generated RK4 executable.
    sir_source = (Path(__file__).resolve().parents[1] /
                  "examples/native_spatial_sir2.flow").read_text(encoding="utf-8")
    status, body = request("POST", "/api/check/flow", sir_source, accepted_headers)
    assert status == 200, ("native nonlinear spatial SIR compile", status, body)
    status, body = request("POST", "/api/run/flow", sir_source, accepted_headers)
    assert status == 200 and "native-spatial-sir2-ok" in body, (
        "native nonlinear spatial SIR numerical acceptance", status, body)
    invalid_sir = sir_source.replace(
        "infectedRight evolves as",
        "infectedRight evolves invalid as",
        1,
    )
    assert invalid_sir != sir_source
    status, body = request("POST", "/api/check/flow", invalid_sir, accepted_headers)
    assert status == 422 and body.strip(), (
        "native nonlinear SIR malformed evolution rejection", status, body)

    # Twelve-state nonlinear periodic SIR on four spatial cells. The upstream
    # Flow compiler generates RK4 and checks every state against an independent
    # high-precision reference, fourth-order refinement and negative cases.
    sir4_source = (Path(__file__).resolve().parents[1] /
                   "examples/native_spatial_sir4.flow").read_text(encoding="utf-8")
    status, body = request("POST", "/api/check/flow", sir4_source, accepted_headers)
    assert status == 200, ("native twelve-state spatial SIR compile", status, body)
    status, body = request("POST", "/api/run/flow", sir4_source, accepted_headers)
    assert status == 200 and "native-spatial-sir4-ok" in body, (
        "native twelve-state nonlinear spatial SIR numerical acceptance", status, body)
    malformed_sir4 = sir4_source.replace(
        "infectedSouth evolves as", "infectedSouth evolves invalid as", 1)
    assert malformed_sir4 != sir4_source
    status, body = request("POST", "/api/check/flow", malformed_sir4, accepted_headers)
    assert status == 422 and body.strip(), (
        "native twelve-state malformed evolution rejection", status, body)

    # Negative compiler acceptance: malformed evolution syntax must be
    # rejected by the real compiler rather than accepted by a lexical scan.
    invalid_ring = ring_source.replace(
        "west evolves as rate * (south - west)",
        "west evolves as rate * (south -",
        1,
    )
    assert invalid_ring != ring_source
    status, body = request("POST", "/api/check/flow", invalid_ring, accepted_headers)
    assert status == 422 and body.strip(), (
        "native evolution malformed-source rejection", status, body)

    # Actual upstream Flow 2.0 evolution DSL on a 2x2 periodic anisotropic
    # heat grid: four compiler-generated RK4 coupled states, analytic Fourier
    # convergence, mean conservation, transposition, and invalid-input checks.
    heat2d_source = (Path(__file__).resolve().parents[1] /
                     "examples/native_evolution_heat2d.flow").read_text(encoding="utf-8")
    status, body = request("POST", "/api/check/flow", heat2d_source, accepted_headers)
    assert status == 200, ("native evolution heat2d compile", status, body)
    status, body = request("POST", "/api/run/flow", heat2d_source, accepted_headers)
    assert status == 200 and "native-evolution-heat2d-ok" in body, (
        "native evolution heat2d RK4 Fourier acceptance", status, body)
    invalid_heat2d = heat2d_source.replace(
        "southeast evolves as 2.0 * diffusivity_x",
        "southeast evolves as (2.0 * diffusivity_x",
        1,
    )
    assert invalid_heat2d != heat2d_source
    status, body = request("POST", "/api/check/flow", invalid_heat2d, accepted_headers)
    assert status == 422 and body.strip(), (
        "native evolution heat2d malformed-equation rejection", status, body)

    # Execute the SAME native Flow unit and expression-IR modules through the
    # production compiler/HTTP route. The server stages anonymous /tmp source,
    # so relative imports cannot resolve; concatenate the checked-in modules
    # without altering their executable bodies. This is not source-grammar
    # lowering and does not imply the editor can import these modules directly.
    math_sources = [
        (Path(__file__).resolve().parents[1] / path).read_text(encoding="utf-8")
        for path in (
            "src/math_dimensions.flow",
            "src/math_expression_ir.flow",
            "src/math_expression_ir_smoke.flow",
        )
    ]
    native_math_ir = "\n".join(
        "\n".join(
            line.removeprefix("export ")
            for line in source.splitlines()
            if not line.startswith("import .math_dimensions {")
            and not line.startswith("import .math_expression_ir {")
        )
        for source in math_sources
    )
    assert "function evaluate_math_ir(" in native_math_ir
    assert "native-math-ir-ok" in native_math_ir
    status, body = request("POST", "/api/check/flow", native_math_ir, accepted_headers)
    assert status == 200, ("native typed mathematical IR compile", status, body)
    status, body = request("POST", "/api/run/flow", native_math_ir, accepted_headers)
    assert status == 200 and "native-math-ir-ok" in body, (
        "native typed mathematical IR execution", status, body)
    malformed_math_ir = native_math_ir.replace(
        "function evaluate_math_ir(program: MathProgram) -> MathResult {",
        "function evaluate_math_ir(program: MathProgram -> MathResult {",
        1,
    )
    assert malformed_math_ir != native_math_ir
    status, body = request("POST", "/api/check/flow", malformed_math_ir, accepted_headers)
    assert status == 422 and body.strip(), (
        "native typed mathematical IR malformed source rejection", status, body)

    # Native source-to-IR lowering: concatenate the exact checked-in Flow
    # modules into a temporary executable because HTTP staging has no
    # relative-module import root. This tests the real compiler and runtime.
    math_source_files = (
        "src/math_dimensions.flow",
        "src/math_expression_ir.flow",
        "src/math_expression_source.flow",
        "src/math_expression_source_smoke.flow",
    )
    native_math_source = "\n".join(
        "\n".join(
            line.removeprefix("export ")
            for line in (Path(__file__).resolve().parents[1] / path)
                .read_text(encoding="utf-8").splitlines()
            if not line.startswith("import .math_dimensions {")
            and not line.startswith("import .math_expression_ir {")
            and not line.startswith("import .math_expression_source {")
        )
        for path in math_source_files
    )
    assert "function parse_math_expression(" in native_math_source
    assert "native-math-source-ok" in native_math_source
    status, body = request("POST", "/api/check/flow", native_math_source, accepted_headers)
    assert status == 200, ("native mathematical source compile", status, body)
    status, body = request("POST", "/api/run/flow", native_math_source, accepted_headers)
    assert status == 200 and "native-math-source-ok" in body, (
        "native mathematical source execution", status, body)
    broken_math_source = native_math_source.replace(
        "function parse_math_expression(source: string) -> ParsedMathExpression {",
        "function parse_math_expression(source: string -> ParsedMathExpression {",
        1,
    )
    assert broken_math_source != native_math_source
    status, body = request("POST", "/api/check/flow", broken_math_source, accepted_headers)
    assert status == 422 and body.strip(), (
        "native mathematical source invalid compiler syntax", status, body)

    # Native typed scalar equation AST: the exact checked-in Flow modules
    # are bundled for the anonymous HTTP compiler, preserving source spans.
    equation_files = (
        "src/math_dimensions.flow",
        "src/math_expression_ir.flow",
        "src/math_expression_source.flow",
        "src/math_equation.flow",
        "src/math_equation_smoke.flow",
    )
    native_equation = "\n".join(
        "\n".join(
            line.removeprefix("export ")
            for line in (Path(__file__).resolve().parents[1] / path)
                .read_text(encoding="utf-8").splitlines()
            if not line.startswith("import .math_dimensions {")
            and not line.startswith("import .math_expression_ir {")
            and not line.startswith("import .math_expression_source {")
            and not line.startswith("import .math_equation {")
        )
        for path in equation_files
    )
    assert "function parse_math_equation(" in native_equation
    assert "native-math-equation-ok" in native_equation
    status, body = request("POST", "/api/check/flow", native_equation, accepted_headers)
    assert status == 200, ("native mathematical equation compile", status, body)
    status, body = request("POST", "/api/run/flow", native_equation, accepted_headers)
    assert status == 200 and "native-math-equation-ok" in body, (
        "native mathematical equation execution", status, body)
    malformed_equation = native_equation.replace(
        "function parse_math_equation(source: string) -> MathEquation {",
        "function parse_math_equation(source: string -> MathEquation {",
        1,
    )
    assert malformed_equation != native_equation
    status, body = request("POST", "/api/check/flow", malformed_equation, accepted_headers)
    assert status == 422 and body.strip(), (
        "native mathematical equation malformed-source rejection", status, body)

    # Native value-independent static SI inference is compiled and executed
    # using the exact checked-in Flow modules through production HTTP.
    # This is separate from runtime evaluation and never runs editor snippets.
    static_files = (
        "src/math_dimensions.flow",
        "src/math_expression_ir.flow",
        "src/math_expression_source.flow",
        "src/math_equation.flow",
        "src/math_static.flow",
        "src/math_static_smoke.flow",
    )
    native_static = "\n".join(
        "\n".join(
            line.removeprefix("export ")
            for line in (Path(__file__).resolve().parents[1] / path)
                .read_text(encoding="utf-8").splitlines()
            if not line.startswith("import .math_dimensions {")
            and not line.startswith("import .math_expression_ir {")
            and not line.startswith("import .math_expression_source {")
            and not line.startswith("import .math_equation {")
            and not line.startswith("import .math_static {")
        )
        for path in static_files
    )
    assert "function infer_math_ir(" in native_static
    assert "native-math-static-ok" in native_static
    status, body = request("POST", "/api/check/flow", native_static, accepted_headers)
    assert status == 200, ("native mathematical static inference compile", status, body)
    status, body = request("POST", "/api/run/flow", native_static, accepted_headers)
    assert status == 200 and "native-math-static-ok" in body, (
        "native mathematical static inference execution", status, body)
    broken_static = native_static.replace(
        "function infer_math_ir(program: MathProgram) -> MathInferredType {",
        "function infer_math_ir(program: MathProgram -> MathInferredType {",
        1,
    )
    assert broken_static != native_static
    status, body = request("POST", "/api/check/flow", broken_static, accepted_headers)
    assert status == 422 and body.strip(), (
        "native mathematical static inference invalid compiler syntax", status, body)

    # Native bounded 2D advection-diffusion, including nonzero transport
    # velocities and a complex Fourier eigenvalue. Real compiler and execution.
    transport_source = (Path(__file__).resolve().parents[1] /
                        "examples/native_advection_diffusion_2d.flow").read_text(encoding="utf-8")
    status, body = request("POST", "/api/check/flow", transport_source, accepted_headers)
    assert status == 200, ("native transport compile", status, body)
    status, body = request("POST", "/api/run/flow", transport_source, accepted_headers)
    assert status == 200 and "native-advection-diffusion2d-ok" in body, (
        "native transport Fourier RK4 execution", status, body)
    malformed_transport = transport_source.replace(
        "let exactSine: f64 = 0.12293328235722417",
        "let exactSine: f64 = (0.12293328235722417",
        1,
    )
    assert malformed_transport != transport_source
    status, body = request("POST", "/api/check/flow", malformed_transport, accepted_headers)
    assert status == 422 and body.strip(), (
        "native transport malformed-source rejection", status, body)

    # Real upstream Flow 2.0 compiler-generated RK4 on a 3x3 periodic grid.
    # Distinct left/right and up/down neighbors; nine coupled states, exact
    # semidiscrete Fourier oracle, convergence, conservation and transposition.
    heat3x3_source = (Path(__file__).resolve().parents[1] /
                     "examples/native_evolution_heat3x3.flow").read_text(encoding="utf-8")
    status, body = request("POST", "/api/check/flow", heat3x3_source, accepted_headers)
    assert status == 200, ("native evolution heat3x3 compile", status, body)
    status, body = request("POST", "/api/run/flow", heat3x3_source, accepted_headers)
    assert status == 200 and "native-evolution-heat3x3-ok" in body, (
        "native evolution heat3x3 analytic RK4 execution", status, body)
    invalid_heat3x3 = heat3x3_source.replace(
        "southeast evolves as diffusivity_x *",
        "southeast evolves as (diffusivity_x *",
        1,
    )
    assert invalid_heat3x3 != heat3x3_source
    status, body = request("POST", "/api/check/flow", invalid_heat3x3, accepted_headers)
    assert status == 422 and body.strip(), (
        "native evolution heat3x3 malformed-source rejection", status, body)

    # Real upstream Flow 2.0 compiler-generated RK4 for eighteen states:
    # two exchanging species on a 3x3 periodic grid, distinct neighbors,
    # unequal anisotropic tensors, nine 2D Fourier matrix-exponential modes.
    # Flow main() asserts all 18 cells, fourth-order convergence, invariants,
    # spatial/species symmetries, semigroup consistency and invalid inputs.
    coupled3x3_source = (Path(__file__).resolve().parents[1] /
                        "examples/native_coupled_evolution3x3.flow").read_text(encoding="utf-8")
    status, body = request("POST", "/api/check/flow", coupled3x3_source, accepted_headers)
    assert status == 200, ("native coupled evolution3x3 compile", status, body)
    status, body = request("POST", "/api/run/flow", coupled3x3_source, accepted_headers)
    assert status == 200 and "native-coupled-evolution3x3-ok" in body, (
        "native coupled evolution3x3 analytical RK4 execution", status, body)
    malformed_coupled3x3 = coupled3x3_source.replace(
        "vSoutheast evolves as diffusivity_vx *",
        "vSoutheast evolves as (diffusivity_vx *",
        1,
    )
    assert malformed_coupled3x3 != coupled3x3_source
    status, body = request("POST", "/api/check/flow", malformed_coupled3x3, accepted_headers)
    assert status == 422 and body.strip(), (
        "native coupled evolution3x3 malformed-source rejection", status, body)

    # Eight coupled states, two anisotropic diffusion tensors and a nonzero
    # species-exchange rate: the upstream Flow compiler generates the RK4
    # integrator. Flow main() verifies all eight exact Walsh/matrix-exponential
    # cells, fourth-order convergence, conservation, species exchange,
    # transpose and rate/time symmetries, plus fail-closed invalid inputs.
    coupled_evolution_source = (Path(__file__).resolve().parents[1] /
                                "examples/native_coupled_evolution2d.flow").read_text(encoding="utf-8")
    status, body = request("POST", "/api/check/flow", coupled_evolution_source, accepted_headers)
    assert status == 200, ("native coupled evolution2d compile", status, body)
    status, body = request("POST", "/api/run/flow", coupled_evolution_source, accepted_headers)
    assert status == 200 and "native-coupled-evolution2d-ok" in body, (
        "native coupled evolution2d analytical RK4 execution", status, body)
    # Reject an actually malformed coupled evolution equation through flowc.
    invalid_coupled = coupled_evolution_source.replace(
        "vSoutheast evolves as 2.0 * diffusivity_vx *",
        "vSoutheast evolves as (2.0 * diffusivity_vx *",
        1,
    )
    assert invalid_coupled != coupled_evolution_source
    status, body = request("POST", "/api/check/flow", invalid_coupled, accepted_headers)
    assert status == 422 and body.strip(), (
        "native coupled evolution malformed-source rejection", status, body)

    # Four independently phased Fourier modes through the REAL persistent CPython
    # kernel and Flow-owned HTTP transport, not a replacement numerical solver.
    # Execute the checked-in solver source in an isolated namespace to prevent
    # its CLI entrypoint from running, then execute the same complex example.
    solver_source = (Path(__file__).resolve().parents[1] /
                     "examples/spectral_interop_python.py").read_text(encoding="utf-8")
    complex_source = (Path(__file__).resolve().parents[1] /
                      "examples/complex_multimode_tensor.py").read_text(encoding="utf-8")
    solver_import = "from spectral_interop_python import integrate\n"
    assert solver_import in complex_source
    complex_http = (
        "solver_namespace = {'__name__': 'flowstudio_spectral_import'}\n"
        + "exec(" + repr(solver_source) + ", solver_namespace)\n"
        + "integrate = solver_namespace['integrate']\n"
        + complex_source.replace(solver_import, "").replace("from __future__ import annotations\n", "")
        + "\nprint('complex-multimode-http ' + json.dumps(verify(), allow_nan=False))\n"
    )
    status, body = request("POST", "/api/run/python", complex_http, accepted_headers)
    assert status == 200, ("complex multimode Python HTTP", status, body[:500])
    marker = "complex-multimode-http "
    assert marker in body, ("complex multimode marker", body[-500:])
    report = json.loads(body.split(marker)[-1].strip())
    assert (report["grid"], report["modes"], report["steps"]) == (24, 4, 80), report
    assert report["max_discrete_error"] < 3e-10, report
    assert abs(report["mean"] - 50.0) < 2e-11, report
    assert (report["temporal_errors"][0] > 3.4 * report["temporal_errors"][1]
            and report["temporal_errors"][1] > 3.4 * report["temporal_errors"][2]), report
    # Real Flow HTTP route, request intent/origin gate, and safe Quarto
    # preflight rejection (does not require Quarto to be installed).
    invalid_qmd = "---\nformat: pdf\n---\n\n# Wrong format\n"
    assert request("POST", "/api/render/quarto", invalid_qmd)[0] == 404
    assert request("POST", "/api/render/quarto", invalid_qmd,
                   {"X-FlowStudio-Intent": "run",
                    "Origin": "http://attacker.invalid"})[0] == 404
    status, body = request("POST", "/api/render/quarto", invalid_qmd, accepted_headers)
    assert status == 422 and "format: html" in body, (status, body)
    if shutil.which("quarto"):
        # This is actual installed-Quarto acceptance; the renderer invokes
        # the real quarto binary.
        status, body = request("POST", "/api/render/quarto",
                               "---\ntitle: Native Quarto smoke\nformat: html\n---\n\n"
                               "## Native Quarto smoke\n", accepted_headers)
        assert status == 200 and "Native Quarto smoke" in body, (status, body[:500])
    # End-to-end Unicode mathematical Flow: actual native Flow HTTP routing,
    # Python frontend, NumPy pressure solver and numerical validation.
    math_source = (Path(__file__).resolve().parents[1] / "examples/navier_stokes_proposed.flow").read_text(encoding="utf-8")
    math_small = (Path(__file__).resolve().parents[1] / "examples/navier_stokes_smoke.flow").read_text(encoding="utf-8")
    assert request("POST", "/api/run/mathflow", math_small)[0] == 404
    assert request("POST", "/api/run/mathflow", math_small,
                   {"X-FlowStudio-Intent": "run", "Origin": "http://attacker.invalid"})[0] == 404
    status, body = request("POST", "/api/check/mathflow", math_small, accepted_headers)
    assert status == 200 and json.loads(body)["ok"], (status, body)
    status, body = request("POST", "/api/run/mathflow", math_small, accepted_headers)
    result = json.loads(body)
    assert status == 200 and result["ok"] and result["steps"] == 10, (status, result)
    assert result["max_divergence"] < 1e-5, result
    assert result["spatial"]["grid"] == [16, 16], result
    assert set(result["spatial"]["fields"]) == {"velocity_x", "velocity_y", "vorticity"}, result
    assert result["observations"][0]["time"] == 0.0, result
    assert abs(result["observations"][-1]["kineticEnergy"] - result["kinetic_energy"]) < 1e-10, result
    assert result["kinetic_energy"] <= result["initial_kinetic_energy"] * 1.001, result
    bad_math = math_small.replace("kinematicViscosity ∇²velocity", "kinematicViscosity velocity")
    status, body = request("POST", "/api/check/mathflow", bad_math, accepted_headers)
    assert status == 422 and not json.loads(body)["ok"], (status, body)
    # Second PDE family: actual native Flow HTTP -> Python typed parser -> NumPy RK2.
    heat_source = (Path(__file__).resolve().parents[1] /
                   "examples/heat_equation_smoke.flow").read_text(encoding="utf-8")
    status, body = request("POST", "/api/check/mathflow", heat_source, accepted_headers)
    assert status == 200 and json.loads(body)["ok"], (status, body)
    status, body = request("POST", "/api/run/mathflow", heat_source, accepted_headers)
    heat = json.loads(body)
    assert status == 200 and heat["ok"] and heat["steps"] == 100, (status, heat)
    assert abs(heat["mean_temperature"] - 300.0) < 1e-8, heat
    assert heat["spatial"]["grid"] == [24, 24], heat
    assert len(heat["spatial"]["fields"]["temperature"]) == 24, heat
    assert heat["temperature_variance"] < heat["initial_temperature_variance"], heat
    assert abs(heat["observations"][-1]["temperatureVariance"] - heat["temperature_variance"]) < 1e-10, heat
    # Execute a genuinely parsed typed equation with a nonzero physical source.
    forced_source = (Path(__file__).resolve().parents[1] /
                     "examples/heat_equation_forced.flow").read_text(encoding="utf-8")
    status, body = request("POST", "/api/check/mathflow", forced_source, accepted_headers)
    assert status == 200 and json.loads(body)["ok"], (status, body)
    status, body = request("POST", "/api/run/mathflow", forced_source, accepted_headers)
    forced = json.loads(body)
    assert status == 200 and forced["ok"] and forced["steps"] == 100, (status, forced)
    assert abs(forced["mean_temperature"] - 300.02) < 1e-8, forced
    assert forced["temperature_variance"] < forced["initial_temperature_variance"], forced
    assert forced["spatial"]["fields"]["temperature"], forced
    # Time-dependent forcing must use the real clock at BOTH RK2 stages.
    temporal_source = (Path(__file__).resolve().parents[1] /
                       "examples/heat_temporal_forcing.flow").read_text(encoding="utf-8")
    status, body = request("POST", "/api/check/mathflow", temporal_source, accepted_headers)
    assert status == 200 and json.loads(body)["ok"], (status, body)
    status, body = request("POST", "/api/run/mathflow", temporal_source, accepted_headers)
    temporal = json.loads(body)
    expected_mean = 300 + (1 - math.cos(2 * math.pi * 0.01)) / math.pi
    assert status == 200 and temporal["ok"] and temporal["steps"] == 100, (status, temporal)
    assert abs(temporal["mean_temperature"] - expected_mean) < 2e-8, temporal
    assert temporal["spatial"]["fields"]["temperature"], temporal
    invalid_temporal = temporal_source.replace("sin(2πt / 1s)", "sin(2πt / 1m)")
    status, body = request("POST", "/api/check/mathflow", invalid_temporal, accepted_headers)
    assert status == 422 and not json.loads(body)["ok"], (status, body)
    # Multiple independent space/time sources must execute through native HTTP,
    # including negative terms and the actual second RK2 stage clock.
    composed_source = (Path(__file__).resolve().parents[1] /
                       "examples/heat_composed_forcing.flow").read_text(encoding="utf-8")
    status, body = request("POST", "/api/check/mathflow", composed_source, accepted_headers)
    assert status == 200 and json.loads(body)["ok"], (status, body)
    status, body = request("POST", "/api/run/mathflow", composed_source, accepted_headers)
    composed = json.loads(body)
    expected_composed = (300 + (1 - math.cos(2 * math.pi * 0.01)) / math.pi
                         + 3 * math.sin(2 * math.pi * 0.01) / (2 * math.pi) - 0.01)
    assert status == 200 and composed["ok"] and composed["steps"] == 100, (status, composed)
    assert abs(composed["mean_temperature"] - expected_composed) < 3e-8, composed
    assert composed["spatial"]["fields"]["temperature"], composed
    invalid_composed = composed_source.replace("+ 2K/s * sin(2πy / 1m)",
                                               "+ temperature / 1s")
    status, body = request("POST", "/api/check/mathflow", invalid_composed, accepted_headers)
    assert status == 422 and not json.loads(body)["ok"], (status, body)
    # Saturating nonlinear kinetics must be parsed, dimension checked and
    # executed through the actual Flow router and NumPy RK2 stages.
    saturating_source = (Path(__file__).resolve().parents[1] /
                         "examples/heat_saturating_reaction.flow").read_text(encoding="utf-8")
    status, body = request("POST", "/api/check/mathflow", saturating_source, accepted_headers)
    assert status == 200 and json.loads(body)["ok"], (status, body)
    status, body = request("POST", "/api/run/mathflow", saturating_source, accepted_headers)
    saturating = json.loads(body)
    assert status == 200 and saturating["ok"] and saturating["steps"] == 100, (status, saturating)
    assert abs(saturating["mean_temperature"] - 300) < 1e-9, saturating
    assert saturating["temperature_variance"] < saturating["initial_temperature_variance"], saturating
    assert saturating["spatial"]["fields"]["temperature"], saturating
    invalid_saturating = saturating_source.replace(
        "tanh((temperature − ambientTemperature) / ambientTemperature)",
        "tanh(temperature)")
    status, body = request("POST", "/api/check/mathflow", invalid_saturating, accepted_headers)
    assert status == 422 and not json.loads(body)["ok"], (status, body)
    # Typed reaction-diffusion: native Flow HTTP -> NumPy RK2 -> real field diagnostics.
    reaction_source = (Path(__file__).resolve().parents[1] /
                       "examples/heat_reaction_diffusion.flow").read_text(encoding="utf-8")
    status, body = request("POST", "/api/check/mathflow", reaction_source, accepted_headers)
    assert status == 200 and json.loads(body)["ok"], (status, body)
    status, body = request("POST", "/api/run/mathflow", reaction_source, accepted_headers)
    reaction = json.loads(body)
    assert status == 200 and reaction["ok"] and reaction["steps"] == 100, (status, reaction)
    assert 300.0 < reaction["mean_temperature"] < 300.02, reaction
    assert reaction["temperature_variance"] < reaction["initial_temperature_variance"], reaction
    assert reaction["spatial"]["fields"]["temperature"], reaction
    # Executable typed advection-diffusion: native Flow HTTP -> Unicode AST ->
    # centered periodic derivatives -> actual RK2 state and spatial samples.
    advection_source = (Path(__file__).resolve().parents[1] /
                        "examples/heat_advection_diffusion.flow").read_text(encoding="utf-8")
    status, body = request("POST", "/api/check/mathflow", advection_source, accepted_headers)
    assert status == 200 and json.loads(body)["ok"], (status, body)
    status, body = request("POST", "/api/run/mathflow", advection_source, accepted_headers)
    advection = json.loads(body)
    assert status == 200 and advection["ok"] and advection["steps"] == 200, (status, advection)
    assert abs(advection["mean_temperature"] - 300.0) < 1e-8, advection
    assert 0 < advection["temperature_variance"] < advection["initial_temperature_variance"], advection
    assert advection["spatial"]["grid"] == [16, 16], advection
    invalid_advection = advection_source.replace(
        "− advectionVelocityX ∂ₓ(temperature)", "+ advectionVelocityX ∂ₓ(temperature)")
    status, body = request("POST", "/api/check/mathflow", invalid_advection, accepted_headers)
    assert status == 422 and not json.loads(body)["ok"], (status, body)
    # Composed typed transport, linear reaction and forcing must execute
    # through the native FlowStudio HTTP route and the real compiler.
    combined_source = (Path(__file__).resolve().parents[1] /
                       "examples/heat_transport_reaction.flow").read_text(encoding="utf-8")
    status, body = request("POST", "/api/check/mathflow", combined_source, accepted_headers)
    assert status == 200 and json.loads(body)["ok"], (status, body)
    status, body = request("POST", "/api/run/mathflow", combined_source, accepted_headers)
    combined = json.loads(body)
    assert status == 200 and combined["ok"] and combined["steps"] == 200, (status, combined)
    assert 300 < combined["mean_temperature"] < 300.05, combined
    assert 0 < combined["temperature_variance"] < combined["initial_temperature_variance"], combined
    assert combined["spatial"]["grid"] == [16, 16], combined
    invalid_combined = combined_source.replace(
        "− reactionRate (temperature − ambientTemperature)",
        "+ reactionRate (temperature − ambientTemperature)")
    status, body = request("POST", "/api/check/mathflow", invalid_combined, accepted_headers)
    assert status == 422 and not json.loads(body)["ok"], (status, body)
    # Non-periodic face-Dirichlet heat: actual native HTTP -> typed parser ->
    # ghost-cell NumPy RK2 -> measured final spatial temperature field.
    dirichlet_source = (Path(__file__).resolve().parents[1] /
                        "examples/heat_dirichlet.flow").read_text(encoding="utf-8")
    status, body = request("POST", "/api/check/mathflow", dirichlet_source, accepted_headers)
    assert status == 200 and json.loads(body)["ok"], (status, body)
    status, body = request("POST", "/api/run/mathflow", dirichlet_source, accepted_headers)
    dirichlet = json.loads(body)
    assert status == 200 and dirichlet["ok"] and dirichlet["steps"] == 100, (status, dirichlet)
    assert dirichlet["boundary_condition"] == "Dirichlet", dirichlet
    assert dirichlet["boundary_temperature"] == 300.0, dirichlet
    assert dirichlet["spatial"]["grid"] == [16, 16], dirichlet
    assert 300.0 < dirichlet["mean_temperature"] < 310.0, dirichlet
    bad_dirichlet = dirichlet_source.replace("Dirichlet(300K)", "Dirichlet(300m)")
    status, body = request("POST", "/api/check/mathflow", bad_dirichlet, accepted_headers)
    assert status == 422 and not json.loads(body)["ok"], (status, body)
    # Neumann zero-flux heat: real native HTTP, typed K/m boundary and RK2.
    neumann_source = (Path(__file__).resolve().parents[1] /
                      "examples/heat_neumann.flow").read_text(encoding="utf-8")
    status, body = request("POST", "/api/check/mathflow", neumann_source, accepted_headers)
    assert status == 200 and json.loads(body)["ok"], (status, body)
    status, body = request("POST", "/api/run/mathflow", neumann_source, accepted_headers)
    neumann = json.loads(body)
    assert status == 200 and neumann["ok"] and neumann["steps"] == 100, (status, neumann)
    assert neumann["boundary_condition"] == "Neumann", neumann
    assert neumann["boundary_gradient"] == 0.0, neumann
    assert abs(neumann["mean_temperature"] - 300.0) < 1e-8, neumann
    assert neumann["temperature_variance"] < neumann["initial_temperature_variance"], neumann
    assert neumann["spatial"]["grid"] == [16, 16], neumann
    bad_neumann = neumann_source.replace("Neumann(0K/m)", "Neumann(300K)")
    status, body = request("POST", "/api/check/mathflow", bad_neumann, accepted_headers)
    assert status == 422 and not json.loads(body)["ok"], (status, body)
    # Complex oblique Fourier tensor diffusion: production Flow-owned HTTP,
    # actual typed mathematical compiler and NumPy RK2, independent discrete
    # Fourier eigenvalue oracle, every rendered spatial sample, and rejection.
    tensor_source = (Path(__file__).resolve().parents[1] /
                     "examples/heat_fourier_tensor_validation.flow").read_text(encoding="utf-8")
    status, body = request("POST", "/api/check/mathflow", tensor_source, accepted_headers)
    assert status == 200 and json.loads(body)["ok"], (status, body)
    status, body = request("POST", "/api/run/mathflow", tensor_source, accepted_headers)
    tensor = json.loads(body)
    assert status == 200 and tensor["ok"] and tensor["steps"] == 100, (status, tensor)
    n = 24
    eigenvalue = (-4*n*n*.01*math.sin(2*math.pi/n)**2
                  -4*n*n*.02*math.sin(3*math.pi/n)**2
                  -.01*n*n*math.sin(4*math.pi/n)*math.sin(6*math.pi/n))
    z = eigenvalue * .0001
    amplitude = 10 * (1 + z + z*z/2)**100
    assert abs(tensor["mean_temperature"] - 300) < 2e-9, tensor
    assert abs(tensor["temperature_variance"] - amplitude*amplitude/2) < 2e-7, tensor
    assert tensor["spatial"]["grid"] == [24, 24], tensor["spatial"]["grid"]
    for i, row in enumerate(tensor["spatial"]["fields"]["temperature"]):
        for j, actual in enumerate(row):
            x, y = (i + .5)/n, (j + .5)/n
            expected = 300 + amplitude * math.sin(4*math.pi*x + 6*math.pi*y)
            assert abs(actual - expected) < 2e-8, (i, j, actual, expected)
    bad_tensor = tensor_source.replace("crossDiffusivity = 0.01m²/s",
                                       "crossDiffusivity = 0.05m²/s")
    status, body = request("POST", "/api/check/mathflow", bad_tensor, accepted_headers)
    assert status == 422 and not json.loads(body)["ok"], (status, body)

    # Independently selected x-Dirichlet and y-Neumann ghost cells, executed
    # through the native HTTP route rather than editor-only syntax.
    mixed_source = (Path(__file__).resolve().parents[1] /
                    "examples/heat_mixed_boundaries.flow").read_text(encoding="utf-8")
    status, body = request("POST", "/api/check/mathflow", mixed_source, accepted_headers)
    assert status == 200 and json.loads(body)["ok"], (status, body)
    status, body = request("POST", "/api/run/mathflow", mixed_source, accepted_headers)
    mixed = json.loads(body)
    assert status == 200 and mixed["ok"] and mixed["steps"] == 100, (status, mixed)
    assert mixed["boundary_condition"] == "Mixed", mixed
    assert mixed["boundary_axes"]["x"] == {"type": "Dirichlet", "value": 300.0}, mixed
    assert mixed["boundary_axes"]["y"] == {"type": "Neumann", "value": 0.0}, mixed
    assert abs(mixed["mean_temperature"] - 300) < 1e-8, mixed
    assert mixed["spatial"]["grid"] == [16, 16], mixed
    bad_mixed = mixed_source.replace("Neumann(0K/m)", "Neumann(0K)")
    status, body = request("POST", "/api/check/mathflow", bad_mixed, accepted_headers)
    assert status == 422 and not json.loads(body)["ok"], (status, body)
    # Four independently typed thermal faces: real native Flow HTTP, parser,
    # NumPy ghost-cell RK2, and checked-in analytic half-sine eigenmode.
    face_source = (Path(__file__).resolve().parents[1] /
                   "examples/heat_per_face_boundaries.flow").read_text(encoding="utf-8")
    status, body = request("POST", "/api/check/mathflow", face_source, accepted_headers)
    assert status == 200 and json.loads(body)["ok"], (status, body)
    status, body = request("POST", "/api/run/mathflow", face_source, accepted_headers)
    faces = json.loads(body)
    assert status == 200 and faces["ok"] and faces["steps"] == 100, (status, faces)
    assert faces["boundary_condition"] == "Faces", faces
    assert faces["boundary_faces"]["x_min"] == {"type": "Dirichlet", "value": 300.0}, faces
    assert faces["boundary_faces"]["x_max"] == {"type": "Neumann", "value": 0.0}, faces
    assert faces["spatial"]["grid"] == [16, 16], faces
    assert 300 < faces["mean_temperature"] < 310, faces
    bad_faces = face_source.replace("Dirichlet(300K), Neumann(0K/m)",
                                    "Periodic, Neumann(0K/m)")
    status, body = request("POST", "/api/check/mathflow", bad_faces, accepted_headers)
    assert status == 422 and not json.loads(body)["ok"], (status, body)
    # Real Robin heat transfer: native Flow HTTP -> typed compiler -> NumPy RK2.
    robin_source = (Path(__file__).resolve().parents[1] /
                    "examples/heat_robin.flow").read_text(encoding="utf-8")
    status, body = request("POST", "/api/check/mathflow", robin_source, accepted_headers)
    assert status == 200 and json.loads(body)["ok"], (status, body)
    status, body = request("POST", "/api/run/mathflow", robin_source, accepted_headers)
    robin = json.loads(body)
    assert status == 200 and robin["ok"] and robin["steps"] == 100, (status, robin)
    assert robin["boundary_faces"]["x_min"] == {
        "type": "Robin", "value": [300.0, 0.2]}, robin
    assert 300 < robin["mean_temperature"] < 310, robin
    assert robin["spatial"]["grid"] == [16, 16], robin
    bad_robin = robin_source.replace("Robin(300K, 0.2m)", "Robin(300K, 0m)")
    status, body = request("POST", "/api/check/mathflow", bad_robin, accepted_headers)
    assert status == 422 and not json.loads(body)["ok"], (status, body)
    # Directional Unicode second derivatives execute through the native HTTP router.
    anisotropic_source = (Path(__file__).resolve().parents[1] /
                          "examples/heat_anisotropic.flow").read_text(encoding="utf-8")
    status, body = request("POST", "/api/check/mathflow", anisotropic_source, accepted_headers)
    assert status == 200 and json.loads(body)["ok"], (status, body)
    status, body = request("POST", "/api/run/mathflow", anisotropic_source, accepted_headers)
    anisotropic = json.loads(body)
    assert status == 200 and anisotropic["ok"] and anisotropic["steps"] == 100, (status, anisotropic)
    assert anisotropic["boundary_condition"] == "Periodic", anisotropic
    assert anisotropic["temperature_variance"] < anisotropic["initial_temperature_variance"], anisotropic
    assert abs(anisotropic["mean_temperature"] - 300) < 1e-9, anisotropic
    assert "temperature" in anisotropic["spatial"]["fields"], anisotropic
    bad_anisotropic = anisotropic_source.replace("0.02m²/s", "0.02m/s")
    status, body = request("POST", "/api/check/mathflow", bad_anisotropic, accepted_headers)
    assert status == 422 and not json.loads(body)["ok"], (status, body)
    # Real nonlinear reaction-diffusion via native Flow HTTP and NumPy RK2.
    nonlinear_source = (Path(__file__).resolve().parents[1] /
                        "examples/heat_nonlinear_reaction.flow").read_text(encoding="utf-8")
    status, body = request("POST", "/api/check/mathflow", nonlinear_source, accepted_headers)
    assert status == 200 and json.loads(body)["ok"], (status, body)
    status, body = request("POST", "/api/run/mathflow", nonlinear_source, accepted_headers)
    nonlinear = json.loads(body)
    assert status == 200 and nonlinear["ok"] and nonlinear["steps"] == 100, (status, nonlinear)
    assert 300 < nonlinear["mean_temperature"] < 330, nonlinear
    assert nonlinear["temperature_variance"] < nonlinear["initial_temperature_variance"], nonlinear
    assert nonlinear["spatial"]["fields"]["temperature"], nonlinear
    # Exercise Unicode exponent lowering through the actual native HTTP router.
    power_source = (Path(__file__).resolve().parents[1] /
                    "examples/heat_power_reaction.flow").read_text(encoding="utf-8")
    status, body = request("POST", "/api/check/mathflow", power_source, accepted_headers)
    assert status == 200 and json.loads(body)["ok"], (status, body)
    status, body = request("POST", "/api/run/mathflow", power_source, accepted_headers)
    power = json.loads(body)
    assert status == 200 and power["ok"] and power["steps"] == 100, (status, power)
    assert 300 < power["mean_temperature"] < 330, power
    assert power["temperature_variance"] < power["initial_temperature_variance"], power
    invalid_power = power_source.replace("(temperature − ambientTemperature)²",
                                         "(temperature − ambientTemperature)^9")
    status, body = request("POST", "/api/check/mathflow", invalid_power, accepted_headers)
    assert status == 422 and not json.loads(body)["ok"], (status, body)
    invalid_nonlinear = nonlinear_source.replace("/ ambientTemperature", "/ temperature")
    status, body = request("POST", "/api/check/mathflow", invalid_nonlinear, accepted_headers)
    assert status == 422 and not json.loads(body)["ok"], (status, body)
    invalid_reaction = reaction_source.replace(
        "− reactionRate (temperature − ambientTemperature)",
        "+ reactionRate (temperature − ambientTemperature)")
    status, body = request("POST", "/api/check/mathflow", invalid_reaction, accepted_headers)
    assert status == 422 and not json.loads(body)["ok"], (status, body)
    invalid_forcing = forced_source.replace("+ 2K/s", "+ temperature / 1s")
    status, body = request("POST", "/api/check/mathflow", invalid_forcing, accepted_headers)
    assert status == 422 and not json.loads(body)["ok"], (status, body)
    # Unicode spatial derivative ASTs must survive the actual native Flow HTTP
    # request path and the local Python expression unit tests.
    for example, expected_steps, metric in (
        ("navier_stokes_spatial_derivative.flow", 10, "kinetic_energy"),
        ("heat_equation_spatial_derivative.flow", 100, "temperature_variance"),
    ):
        derivative_source = (Path(__file__).resolve().parents[1] /
                             "examples" / example).read_text(encoding="utf-8")
        status, body = request("POST", "/api/check/mathflow",
                               derivative_source, accepted_headers)
        assert status == 200 and json.loads(body)["ok"], (example, status, body)
        status, body = request("POST", "/api/run/mathflow",
                               derivative_source, accepted_headers)
        derivative_result = json.loads(body)
        assert status == 200 and derivative_result["ok"], (example, status, derivative_result)
        assert derivative_result["steps"] == expected_steps, derivative_result
        assert math.isfinite(derivative_result[metric]) and derivative_result[metric] > 0, derivative_result
        assert derivative_result["spatial"]["grid"], derivative_result
    bad_heat = heat_source.replace("300K", "300m")
    status, body = request("POST", "/api/check/mathflow", bad_heat, accepted_headers)
    assert status == 422 and not json.loads(body)["ok"], (status, body)
    # Real Flow HTTP -> C IPC -> persistent Rscript top-level stepping.
    # No interpreter mocks: the native acceptance job installs actual R.
    for route in ("/api/debug/r/start", "/api/debug/r/step",
                  "/api/debug/r/continue", "/api/debug/r/evaluate",
                  "/api/debug/r/stop", "/api/debug/r/status"):
        assert request("POST", route, "", {})[0] == 404
        assert request("POST", route, "",
                       {"X-FlowStudio-Intent": "run",
                        "Origin": "http://attacker.invalid"})[0] == 404
    status, body = request("POST", "/api/debug/r/start",
                           "fs_debug_http <- 41L\ncat(fs_debug_http + 1L)",
                           accepted_headers)
    assert status == 200, (status, body)
    debug = json.loads(body)
    assert debug["state"] == "paused" and debug["next_line"] == 1, debug
    assert request("POST", "/api/run/r", "fs_debug_http <- 999L",
                   accepted_headers)[0] == 422
    status, body = request("POST", "/api/debug/r/step", "", accepted_headers)
    assert status == 200 and json.loads(body)["next_line"] == 2, (status, body)
    status, body = request("POST", "/api/debug/r/evaluate",
                           "fs_debug_http + 1L", accepted_headers)
    debug = json.loads(body)
    assert status == 200 and debug["state"] == "paused" and debug["index"] == 2, debug
    assert debug["next_line"] == 2 and debug["output"].strip() == "[1] 42", debug
    status, body = request("POST", "/api/debug/r/evaluate",
                           "stop('watch failed')", accepted_headers)
    debug = json.loads(body)
    assert status == 422 and debug["state"] == "paused" and debug["index"] == 2, debug
    assert "watch failed" in debug["output"], debug
    status, body = request("POST", "/api/debug/r/evaluate",
                           "fs_debug_http <- 900L; fs_debug_http <- 0L", accepted_headers)
    assert status == 422 and json.loads(body)["index"] == 2, (status, body)
    status, body = request("POST", "/api/debug/r/step", "", accepted_headers)
    assert status == 200, (status, body)
    debug = json.loads(body)
    assert debug["state"] == "done" and debug["output"] == "42", debug
    status, body = request("POST", "/api/debug/r/start",
                            "fs_debug_http <- 40L\nfs_debug_http <- fs_debug_http + 2L\ncat(fs_debug_http)",
                            accepted_headers)
    assert status == 200, (status, body)
    status, body = request("POST", "/api/debug/r/continue", "3", accepted_headers)
    debug = json.loads(body)
    assert status == 200 and debug["state"] == "paused" and debug["next_line"] == 3, debug
    assert debug["executed_line"] == 2, debug
    status, body = request("POST", "/api/debug/r/continue", "1", accepted_headers)
    assert status == 422 and json.loads(body)["next_line"] == 3, (status, body)
    status, body = request("POST", "/api/debug/r/continue", "", accepted_headers)
    assert status == 200 and json.loads(body)["state"] == "done", (status, body)
    assert json.loads(body)["output"] == "42", body
    status, body = request("POST", "/api/debug/r/stop", "", accepted_headers)
    assert status == 200 and json.loads(body)["state"] == "idle", (status, body)
    # Actual Flow HTTP -> C IPC -> Rscript multiple breakpoint acceptance.
    status, body = request("POST", "/api/debug/r/start",
                           "fs_multi_http <- 0L\nfs_multi_http <- fs_multi_http + 1L\n"
                           "fs_multi_http <- fs_multi_http + 10L\n"
                           "fs_multi_http <- fs_multi_http + 100L\ncat(fs_multi_http)",
                           accepted_headers)
    assert status == 200 and json.loads(body)["state"] == "paused", (status, body)
    status, body = request("POST", "/api/debug/r/continue", "4,2", accepted_headers)
    assert status == 200 and json.loads(body)["next_line"] == 2, (status, body)
    status, body = request("POST", "/api/debug/r/continue", "2,,4", accepted_headers)
    assert status == 422 and json.loads(body)["next_line"] == 2, (status, body)
    status, body = request("POST", "/api/debug/r/continue", "4,2", accepted_headers)
    assert status == 200 and json.loads(body)["next_line"] == 4, (status, body)
    status, body = request("POST", "/api/debug/r/continue", "", accepted_headers)
    assert status == 200 and json.loads(body)["state"] == "done", (status, body)
    assert json.loads(body)["output"] == "111", body
    status, body = request("POST", "/api/run/r", "cat(fs_multi_http)", accepted_headers)
    assert status == 200 and body == "111", (status, body)

    # Conditional R breakpoints use real workspace values via Flow-owned HTTP.
    status, body = request("POST", "/api/debug/r/start",
                           "fs_conditional_http <- 0L\n"
                           "fs_conditional_http <- fs_conditional_http + 1L\n"
                           "fs_conditional_http <- fs_conditional_http + 1L\n"
                           "cat(fs_conditional_http)", accepted_headers)
    assert status == 200 and json.loads(body)["state"] == "paused", (status, body)
    status, body = request("POST", "/api/debug/r/continue",
                           "2?fs_conditional_http>=1,3?fs_conditional_http>=1", accepted_headers)
    assert status == 200 and json.loads(body)["next_line"] == 3, (status, body)
    status, body = request("POST", "/api/debug/r/continue", "", accepted_headers)
    assert status == 200 and json.loads(body)["state"] == "done", (status, body)
    assert json.loads(body)["output"] == "2", body
    status, body = request("POST", "/api/debug/r/start",
                           "fs_conditional_http <- 0L\n"
                           "fs_conditional_http <- fs_conditional_http + 1L\n"
                           "cat(fs_conditional_http)", accepted_headers)
    assert status == 200, (status, body)
    status, body = request("POST", "/api/debug/r/continue",
                           "2?fs_conditional_http>=NaN", accepted_headers)
    assert status == 422 and json.loads(body)["index"] == 1, (status, body)
    status, body = request("POST", "/api/debug/r/continue",
                           "3?fs_conditional_http>=2", accepted_headers)
    assert status == 200 and json.loads(body)["state"] == "done", (status, body)
    assert json.loads(body)["output"] == "1", body

    # Actual Flow HTTP -> C IPC -> Rscript postmortem user function frames.
    status, body = request("POST", "/api/debug/r/start",
                           "fs_outer <- function(v) { fs_outer_local <- v + 1L; "
                           "fs_inner <- function(w) { fs_inner_local <- w + 2L; "
                           "stop('frame failure') }; fs_inner(fs_outer_local) }\n"
                           "fs_outer(40L)\ncat('unreachable')", accepted_headers)
    assert status == 200, (status, body)
    assert request("POST", "/api/debug/r/step", "", accepted_headers)[0] == 200
    status, body = request("POST", "/api/debug/r/step", "", accepted_headers)
    frames = json.loads(body)
    assert status == 422 and frames["state"] == "error" and frames["failed_line"] == 2, frames
    assert [frame["call"] for frame in frames["frames"]] == [
        "fs_outer(40L)", "fs_inner(fs_outer_local)"], frames
    assert "fs_outer_local" in frames["frames"][0]["locals"], frames
    assert "fs_inner_local" in frames["frames"][1]["locals"], frames
    # Source metadata is optional when R has discarded srcref. When present,
    # definition_line marks where the function is defined; the live failure
    # location stays in the frame line.
    assert all(frame["definition_line"] is None or
               (isinstance(frame["definition_line"], int) and
                1 <= frame["definition_line"] <= 2)
               for frame in frames["frames"]), frames
    status, body = request("POST", "/api/debug/r/evaluate",
                           "@2\nfs_inner_local", accepted_headers)
    assert status == 200 and json.loads(body)["output"].strip() == "[1] 43", (status, body)
    status, body = request("POST", "/api/debug/r/evaluate",
                           "@8\nfs_inner_local", accepted_headers)
    assert status == 422 and "No retained R function frame" in json.loads(body)["output"]
    status, body = request("POST", "/api/debug/r/stop", "", accepted_headers)
    assert status == 200 and json.loads(body)["frames"] == [], (status, body)
    # The same function called from a later source buffer must not expose its
    # old definition line as a navigation target in the current editor.
    status, body = request("POST", "/api/debug/r/start",
                           "fs_outer(41L)", accepted_headers)
    assert status == 200, (status, body)
    status, body = request("POST", "/api/debug/r/step", "", accepted_headers)
    prior_frames = json.loads(body)
    assert status == 422 and prior_frames["state"] == "error", prior_frames
    assert len(prior_frames["frames"]) == 2, prior_frames
    assert all(frame["definition_line"] is None
               for frame in prior_frames["frames"]), prior_frames
    assert request("POST", "/api/debug/r/stop", "", accepted_headers)[0] == 200

    # Native Git reads and writes require the existing intent/origin gate.
    assert request("GET", "/api/git/status")[0] == 404
    for route in ("/api/git/status", "/api/git/diff", "/api/git/diff/staged",
                  "/api/git/stage", "/api/git/unstage", "/api/git/commit"):
        assert request("POST", route, "")[0] == 404
    assert request("POST", "/api/git/stage", "file.py",
                   {"X-FlowStudio-Intent": "run", "Origin": "http://attacker.invalid"})[0] == 404
    assert request("POST", "/api/git/commit", "message",
                   {"X-FlowStudio-Intent": "run", "Origin": "http://attacker.invalid"})[0] == 404
    assert request("POST", "/api/git/unstage", "file.py",
                   {"X-FlowStudio-Intent": "run", "Origin": "http://attacker.invalid"})[0] == 404
    assert request("POST", "/api/git/stage", ".", accepted_headers)[0] == 400
    assert request("POST", "/api/git/unstage", ".", accepted_headers)[0] == 400
    assert request("POST", "/api/git/unstage", "", accepted_headers)[0] == 400
    assert request("POST", "/api/git/commit", "", accepted_headers)[0] == 400
    assert request("POST", "/api/git/status", "",
                   {"X-FlowStudio-Intent": "run", "Origin": "http://attacker.invalid"})[0] == 404
    status, git_client = request("GET", "/app/git_panel.js")
    assert status == 200 and "FlowStudioGitPanel" in git_client
    assert 'id="gitRefresh"' in browser and 'id="gitDiff"' in browser
    assert 'id="gitStage"' in browser and 'id="gitUnstage"' in browser
    assert 'id="gitCommit"' in browser
    assert 'id="gitStagedDiff"' in browser
    if shutil.which("git"):
        probe = Path(__file__).resolve().parents[1] / ("flowstudio_git_probe_" + uuid.uuid4().hex + ".txt")
        try:
            probe.write_text("native Git status acceptance\\n", encoding="utf-8")
            git_code, git_text = request("POST", "/api/git/status", "", accepted_headers)
            assert git_code == 200 and probe.name in git_text, (git_code, git_text)
            diff_code, diff_text = request("POST", "/api/git/diff", "", accepted_headers)
            assert diff_code == 200 and "fatal:" not in diff_text, (diff_code, diff_text)
            staged_code, staged_text = request("POST", "/api/git/diff/staged", "", accepted_headers)
            assert staged_code == 200 and "fatal:" not in staged_text, (staged_code, staged_text)
        finally:
            probe.unlink(missing_ok=True)
    else:
        assert request("POST", "/api/git/status", "", accepted_headers)[0] == 503
    status, _ = request(
        "POST", "/api/run/python", 'print("bad")',
        {"X-FlowStudio-Intent": "run", "Origin": "http://attacker.invalid"},
    )
    assert status == 404, status

    assert oversized_body_status() == 413

    status, output = request(
        "POST", "/api/run/python", 'print("flowstudio-python-ok")',
        accepted_headers,
    )
    assert status == 200 and "flowstudio-python-ok" in output, (status, output)

    # Flow itself orchestrates both persistent language kernels in one request.
    if shutil.which("Rscript"):
        status, mixed = request("POST", "/api/demo/python-r", "", accepted_headers)
        assert status == 200, (status, mixed)
        assert "Python sum = 15" in mixed, mixed
        assert "R sqrt(sum) = " in mixed, mixed
        r_value = float(mixed.split("R sqrt(sum) = ", 1)[1].strip())
        assert abs(r_value - (15 ** 0.5)) < 0.0001, mixed

    # Native Flow-owned Python trace executes in the persistent CPython kernel.
    status, _ = request("POST", "/api/trace/python", "print('blocked')")
    assert status == 404, status
    status, trace_js = request("GET", "/app/python_trace_view.js")
    assert status == 200 and "FlowStudioPythonTraceView" in trace_js, status
    status, traced = request(
        "POST", "/api/trace/python",
        "native_trace_variable = 40\nprint(native_trace_variable + 2)",
        accepted_headers,
    )
    assert status == 200, (status, traced)
    trace_data = json.loads(traced)
    assert trace_data["ok"] and "42" in trace_data["output"], trace_data
    assert [entry["line"] for entry in trace_data["events"]] == [1, 2], trace_data
    status, output = request(
        "POST", "/api/run/python", "print(native_trace_variable)", accepted_headers,
    )
    assert status == 200 and output.strip() == "40", (status, output)
    status, traced = request(
        "POST", "/api/trace/python", "raise ValueError('trace error')",
        accepted_headers,
    )
    assert status == 422 and "trace error" in json.loads(traced)["output"], (status, traced)

    # Interactive source debugging is real CPython execution in the same
    # persistent kernel, with Flow-owned origin/intent-gated HTTP routes.
    status, debug_script = request("GET", "/app/python_debug_panel.js")
    assert status == 200 and "FlowStudioPythonDebugPanel" in debug_script
    assert 'id="pythonDebugStart"' in browser and 'id="pythonDebugStep"' in browser
    assert request("POST", "/api/debug/python/start", "{}")[0] == 404
    assert request("POST", "/api/debug/python/step", "",
                   {"X-FlowStudio-Intent": "run", "Origin": "http://attacker.invalid"})[0] == 404
    debug_source = "debug_value = 40\ndebug_value += 2\nprint(debug_value)\n"
    status, payload = request("POST", "/api/debug/python/start",
                              json.dumps({"source": debug_source, "breakpoints": [2]}),
                              accepted_headers)
    assert status == 200, (status, payload)
    paused = json.loads(payload)
    assert paused["state"] == "paused" and paused["stack"][0]["line"] == 2, paused
    assert paused["stack"][0]["locals"]["debug_value"]["value"] == "40", paused
    status, output = request("POST", "/api/run/python", "print('must not run')", accepted_headers)
    assert status == 422 and "debugger is active" in output, (status, output)
    status, payload = request("POST", "/api/debug/python/step", "", accepted_headers)
    assert status == 200 and json.loads(payload)["stack"][0]["line"] == 3, (status, payload)
    status, payload = request("POST", "/api/debug/python/continue", "", accepted_headers)
    assert status == 200 and json.loads(payload)["state"] == "done", (status, payload)
    assert "42" in json.loads(payload)["output"], payload
    status, output = request("POST", "/api/run/python", "print(debug_value)", accepted_headers)
    assert status == 200 and output.strip() == "42", (status, output)
    status, payload = request("POST", "/api/debug/python/start",
                              json.dumps({"source": "debug_stop = 1\ndebug_unreached = 2",
                                          "breakpoints": [2]}), accepted_headers)
    assert status == 200 and json.loads(payload)["state"] == "paused", (status, payload)
    status, payload = request("POST", "/api/debug/python/stop", "", accepted_headers)
    assert status == 200 and json.loads(payload)["state"] == "stopped", (status, payload)
    status, output = request("POST", "/api/run/python",
                             "print('debug_unreached' in globals())", accepted_headers)
    assert status == 200 and output.strip() == "False", (status, output)

    # Real one-shot run-to-line through Flow HTTP and the persistent CPython
    # trace worker; the target is not retained after an intervening breakpoint.
    go_source = "go_a = 1\ngo_b = go_a + 1\ngo_c = go_b + 1\nprint(go_c)\n"
    status, payload = request("POST", "/api/debug/python/start",
                              json.dumps({"source": go_source, "breakpoints": [2]}),
                              accepted_headers)
    assert status == 200 and json.loads(payload)["stack"][0]["line"] == 2, payload
    status, payload = request("POST", "/api/debug/python/run-to-line", "99", accepted_headers)
    assert status == 422 and json.loads(payload)["state"] == "paused", payload
    status, payload = request("POST", "/api/debug/python/run-to-line", "4", accepted_headers)
    assert status == 200 and json.loads(payload)["stack"][0]["line"] == 4, payload
    status, payload = request("POST", "/api/debug/python/continue", "", accepted_headers)
    assert status == 200 and json.loads(payload)["state"] == "done", payload
    assert request("POST", "/api/debug/python/run-to-line", "4")[0] == 404
    assert request("POST", "/api/debug/python/run-to-line", "4",
                   {"X-FlowStudio-Intent": "run", "Origin": "http://attacker.invalid"})[0] == 404

    # Real CPython frame-depth stepping: next skips callees; finish exits them.
    depth_source = ("def depth_inner():\n    depth_local = 40\n    return depth_local\n"
                    "depth_result = depth_inner()\nprint(depth_result)\n")
    status, payload = request("POST", "/api/debug/python/start",
                              json.dumps({"source": depth_source, "breakpoints": [4]}),
                              accepted_headers)
    assert status == 200 and json.loads(payload)["stack"][0]["line"] == 4, (status, payload)
    status, payload = request("POST", "/api/debug/python/next", "", accepted_headers)
    assert status == 200 and json.loads(payload)["stack"][0]["line"] == 5, (status, payload)
    assert request("POST", "/api/debug/python/continue", "", accepted_headers)[0] == 200
    status, payload = request("POST", "/api/debug/python/start",
                              json.dumps({"source": depth_source, "breakpoints": [2]}),
                              accepted_headers)
    assert status == 200 and json.loads(payload)["stack"][0]["line"] == 2, (status, payload)
    status, payload = request("POST", "/api/debug/python/finish", "", accepted_headers)
    assert status == 200 and json.loads(payload)["stack"][0]["line"] == 5, (status, payload)
    assert request("POST", "/api/debug/python/continue", "", accepted_headers)[0] == 200
    assert request("POST", "/api/debug/python/next", "")[0] == 404
    assert request("POST", "/api/debug/python/finish", "",
                   {"X-FlowStudio-Intent": "run", "Origin": "http://attacker.invalid"})[0] == 404

    # Conditional breakpoints run in real CPython through Flow's HTTP router.
    # They inspect exact numeric locals only, without evaluating expressions.
    conditional_source = ("for condition_i in range(5):\n"
                          "    condition_seen = condition_i\n"
                          "print(condition_seen)\n")
    status, payload = request("POST", "/api/debug/python/start",
                              json.dumps({"source": conditional_source,
                                          "breakpoints": [{"line": 2, "condition": "condition_i>=3"}]}),
                              accepted_headers)
    conditional = json.loads(payload)
    assert status == 200 and conditional["state"] == "paused", (status, payload)
    assert conditional["stack"][0]["locals"]["condition_i"]["value"] == "3", payload
    status, payload = request("POST", "/api/debug/python/continue", "", accepted_headers)
    assert status == 200 and json.loads(payload)["stack"][0]["locals"]["condition_i"]["value"] == "4", (status, payload)
    status, payload = request("POST", "/api/debug/python/continue", "", accepted_headers)
    assert status == 200 and json.loads(payload)["state"] == "done", (status, payload)
    assert "4" in json.loads(payload)["output"], payload
    status, payload = request("POST", "/api/debug/python/start",
                              json.dumps({"source": "x = 1\n",
                                          "breakpoints": [{"line": 1, "condition": "__import__('os')"}]}),
                              accepted_headers)
    assert status == 422 and not json.loads(payload)["ok"], (status, payload)

    # Exception pause uses real CPython trace events through Flow's HTTP router.
    # Caught exceptions pause once at their origin, without evaluating repr/str.
    exception_source = ('try:\n    raise LookupError("caught")\n'
                        'except LookupError:\n    exception_recovered = 42\n')
    status, payload = request("POST", "/api/debug/python/start",
                              json.dumps({"source": exception_source,
                                          "breakpoints": [],
                                          "pause_on_exception": True}),
                              accepted_headers)
    exception_pause = json.loads(payload)
    assert status == 200 and exception_pause["state"] == "paused", (status, payload)
    assert exception_pause["exception"] == {"type": "LookupError", "line": 2}, payload
    status, payload = request("POST", "/api/debug/python/continue", "", accepted_headers)
    assert status == 200 and json.loads(payload)["state"] == "done", (status, payload)
    assert json.loads(payload)["exception"] is None, payload
    status, output = request("POST", "/api/run/python",
                             "print(exception_recovered)", accepted_headers)
    assert status == 200 and output.strip() == "42", (status, output)
    status, payload = request("POST", "/api/debug/python/start",
                              json.dumps({"source": 'raise ValueError("uncaught")\n',
                                          "breakpoints": [],
                                          "pause_on_exception": True}),
                              accepted_headers)
    assert status == 200 and json.loads(payload)["exception"]["type"] == "ValueError", payload
    status, payload = request("POST", "/api/debug/python/continue", "", accepted_headers)
    assert status == 422 and json.loads(payload)["state"] == "done", (status, payload)
    assert "ValueError: uncaught" in json.loads(payload)["output"], payload
    status, payload = request("POST", "/api/debug/python/start",
                              json.dumps({"source": "pass", "breakpoints": [],
                                          "pause_on_exception": "true"}),
                              accepted_headers)
    assert status == 422 and not json.loads(payload)["ok"], (status, payload)

    # A single Python kernel retains variables between HTTP requests.
    status, output = request("POST", "/api/run/python",
                             "flowstudio_persistent = 40 + 2", accepted_headers)
    assert status == 200, (status, output)
    status, output = request("POST", "/api/run/python",
                             "print(flowstudio_persistent)", accepted_headers)
    assert status == 200 and output.strip() == "42", (status, output)
    status, snapshot = request("POST", "/api/inspect/python", "", accepted_headers)
    assert status == 200, (status, snapshot)
    variables = {item["name"]: item for item in json.loads(snapshot)["variables"]}
    assert variables["flowstudio_persistent"]["type"] == "int", variables
    status, output = request("POST", "/api/run/python",
                             "flowstudio_nested = {'numbers': [1, 2, 3], 'meta': {'ok': True}}",
                             accepted_headers)
    assert status == 200, (status, output)
    status, snapshot = request("POST", "/api/inspect/python", "", accepted_headers)
    assert status == 200, (status, snapshot)
    nested = next(item for item in json.loads(snapshot)["variables"]
                  if item["name"] == "flowstudio_nested")
    assert nested["type"] == "dict" and nested["size"] == 2, nested
    assert nested["children"][0]["name"] == '["numbers"]', nested
    assert [item["type"] for item in nested["children"][0]["children"]] == [
        "int", "int", "int"], nested
    status, _ = request("POST", "/api/inspect/python", "")
    assert status == 404, status
    status, output = request("POST", "/api/run/python",
                             "raise ValueError('session-error')", accepted_headers)
    assert status == 422 and "ValueError: session-error" in output, (status, output)
    status, output = request("POST", "/api/run/python",
                             "print(flowstudio_persistent)", accepted_headers)
    assert status == 200 and output.strip() == "42", (status, output)
    status, output = request("POST", "/api/reset/python", "", accepted_headers)
    assert status == 200 and "reset" in output, (status, output)
    status, snapshot = request("POST", "/api/inspect/python", "", accepted_headers)
    assert status == 200, (status, snapshot)
    assert not any(item["name"] == "flowstudio_persistent"
                   for item in json.loads(snapshot)["variables"])
    status, output = request("POST", "/api/run/python",
                             "print('flowstudio_persistent' in globals())", accepted_headers)
    assert status == 200 and output.strip() == "False", (status, output)
    status, _ = request("POST", "/api/reset/python", "")
    assert status == 404, status

    if shutil.which("Rscript"):
        status, _ = request("POST", "/api/check/r", "value <- 1")
        assert status == 404, status
        status, _ = request("POST", "/api/check/r", "value <- 1",
                            {"X-FlowStudio-Intent": "run", "Origin": "http://attacker.invalid"})
        assert status == 404, status
        status, output = request("POST", "/api/run/r",
                                 'flowstudio_r_value <- 41; cat(flowstudio_r_value, "\\n")',
                                 accepted_headers)
        assert status == 200 and output.strip() == "41", (status, output)
        status, output = request("POST", "/api/check/r",
                                 "flowstudio_r_value <- 999; stop('must not run')",
                                 accepted_headers)
        assert status == 200 and "not executed" in output, (status, output)
        status, output = request("POST", "/api/check/r", "flowstudio_r_value <- )",
                                 accepted_headers)
        assert status == 422 and "R syntax error:" in output and "<text>:" in output, (status, output)
        status, output = request("POST", "/api/run/r",
                                 'cat(flowstudio_r_value, "\\n")', accepted_headers)
        assert status == 200 and output.strip() == "41", (status, output)
        status, output = request("POST", "/api/run/r",
                                 'flowstudio_r_value <- flowstudio_r_value + 1; cat(flowstudio_r_value, "\\n")',
                                 accepted_headers)
        assert status == 200 and output.strip() == "42", (status, output)
        # Exercise compiled C via the actual native R HTTP kernel.
        status, output = request(
            "POST", "/api/run/r",
            "flowjit_x <- as.double(seq_len(512L)); "
            "flowjit_f <- flowjit_compile(function(x) x * x + 1.0, "
            "hot = 1L, min_length = 32L); "
            "stopifnot(identical(flowjit_f(flowjit_x), "
            "flowjit_x * flowjit_x + 1.0)); "
            "cat('flowjit-native=', flowjit_status(flowjit_f)$native, '\\n', sep='')",
            accepted_headers)
        assert status == 200 and "flowjit-native=1" in output, (status, output)
        # Guard failures are counted and handled by baseline GNU R.
        status, output = request(
            "POST", "/api/run/r",
            "stopifnot(identical(flowjit_f(1:4), 1:4 * 1:4 + 1.0)); "
            "cat('flowjit-fallback=', flowjit_status(flowjit_f)$fallback, '\\n', sep='')",
            accepted_headers)
        assert status == 200 and "flowjit-fallback=1" in output, (status, output)
        status, snapshot = request("POST", "/api/inspect/r", "", accepted_headers)
        assert status == 200, (status, snapshot)
        r_snapshot = json.loads(snapshot)
        r_variables = {item["name"]: item for item in r_snapshot["variables"]}
        assert r_variables["flowstudio_r_value"]["type"] == "double", r_variables
        assert r_variables["flowstudio_r_value"]["size"] == 1, r_variables
        status, output = request("POST", "/api/run/r",
                                 "flowstudio_matrix <- matrix(1:6, nrow=2)",
                                 accepted_headers)
        assert status == 200, (status, output)
        status, snapshot = request("POST", "/api/inspect/r", "", accepted_headers)
        assert status == 200, (status, snapshot)
        matrix_variables = {item["name"]: item for item in json.loads(snapshot)["variables"]}
        assert matrix_variables["flowstudio_matrix"]["dimensions"] == [2, 3], matrix_variables
        assert matrix_variables["flowstudio_r_value"]["dimensions"] is None, matrix_variables
        status, output = request("POST", "/api/run/r",
                                 'flowstudio_nested <- list(numbers=list(answer=42L), values=c(1,2))',
                                 accepted_headers)
        assert status == 200, (status, output)
        status, snapshot = request("POST", "/api/inspect/r", "", accepted_headers)
        assert status == 200, (status, snapshot)
        nested = {item["name"]: item for item in json.loads(snapshot)["variables"]}["flowstudio_nested"]
        assert nested["type"] == "list" and nested["size"] == 2, nested
        assert nested["children"][0]["name"] == "[[1]] numbers", nested
        assert nested["children"][0]["children"][0]["type"] == "integer", nested
        # Native R table preview is a read-only IPC operation in the same session.
        assert request("POST", "/api/table/r", "flowstudio_matrix")[0] == 404
        assert request("POST", "/api/table/r", "flowstudio_matrix",
                       {"X-FlowStudio-Intent": "run",
                        "Origin": "http://attacker.invalid"})[0] == 404
        status, table_json = request("POST", "/api/table/r", "flowstudio_matrix",
                                     accepted_headers)
        assert status == 200, (status, table_json)
        table = json.loads(table_json)
        assert table["columns"] == ["Column 1", "Column 2", "Column 3"], table
        assert table["rows"] == [["1", "3", "5"], ["2", "4", "6"]], table
        assert table["totalRows"] == 2 and not table["truncated"], table
        status, _ = request("POST", "/api/run/r",
                            "flowstudio_frame <- data.frame(x=c('a', 'b'), y=c(NA, 42))",
                            accepted_headers)
        assert status == 200, status
        status, table_json = request("POST", "/api/table/r", "flowstudio_frame",
                                     accepted_headers)
        assert status == 200, (status, table_json)
        frame = json.loads(table_json)
        assert frame["columns"] == ["x", "y"], frame
        assert frame["rows"] == [["a", ""], ["b", "42"]], frame
        status, error = request("POST", "/api/table/r",
                                "flowstudio_frame;stop('should not run')", accepted_headers)
        assert status == 422 and "Invalid R table name" in error, (status, error)
        # Real paged reads go through the Flow router and the same persistent R
        # workspace. A second page must return rows that were never previewed.
        status, _ = request("POST", "/api/run/r",
                            "flowstudio_paged <- data.frame(n=seq_len(251))",
                            accepted_headers)
        assert status == 200, status
        status, page_json = request("POST", "/api/table/r", "flowstudio_paged",
                                     accepted_headers)
        assert status == 200, (status, page_json)
        first_page = json.loads(page_json)
        assert first_page["offset"] == 0 and first_page["nextOffset"] == 200
        assert len(first_page["rows"]) == 200, first_page
        status, page_json = request("POST", "/api/table/r", "flowstudio_paged\t200",
                                     accepted_headers)
        assert status == 200, (status, page_json)
        second_page = json.loads(page_json)
        assert second_page["offset"] == 200 and second_page["nextOffset"] is None
        assert second_page["rows"][0] == ["201"] and second_page["rows"][-1] == ["251"]
        status, error = request("POST", "/api/table/r",
                                "flowstudio_paged\t200;stop('unsafe')", accepted_headers)
        assert status == 422 and "Invalid R table name" in error, (status, error)
        # Read-only native R package inventory is served through Flow, never eval.
        assert request("POST", "/api/packages/r", "")[0] == 404
        assert request("POST", "/api/packages/r", "",
                       {"X-FlowStudio-Intent": "run",
                        "Origin": "http://attacker.invalid"})[0] == 404
        status, package_json = request("POST", "/api/packages/r", "", accepted_headers)
        assert status == 200, (status, package_json[:120])
        inventory = json.loads(package_json)
        assert isinstance(inventory["packages"], list) and len(inventory["packages"]) <= 1000
        assert any(item["name"] == "stats" for item in inventory["packages"]), inventory
        assert isinstance(inventory["truncated"], bool)
        # Attach an installed R package through the same Flow-owned session.
        assert request("POST", "/api/packages/r/load", "splines")[0] == 404
        assert request("POST", "/api/packages/r/load", "splines",
                       {"X-FlowStudio-Intent": "run",
                        "Origin": "http://attacker.invalid"})[0] == 404
        status, output = request("POST", "/api/packages/r/load", "splines", accepted_headers)
        assert status == 200 and "Loaded installed R package splines" in output, (status, output)
        status, output = request("POST", "/api/run/r",
                                 "cat('package:splines' %in% search())", accepted_headers)
        assert status == 200 and output.strip() == "TRUE", (status, output)
        status, output = request("POST", "/api/packages/r/load",
                                 "splines;stop('unsafe')", accepted_headers)
        assert status == 422 and "Invalid R package name" in output, (status, output)
        status, output = request("POST", "/api/packages/r/load",
                                 "FlowStudioPackageDefinitelyMissing", accepted_headers)
        assert status == 422 and "there is no package" in output, (status, output)
        # Native CRAN install is explicit and origin/intent gated. Test a
        # preinstalled base package so CI never requires network access.
        assert request("POST", "/api/packages/r/install", "stats")[0] == 404
        assert request("POST", "/api/packages/r/install", "stats",
                       {"X-FlowStudio-Intent": "run",
                        "Origin": "http://attacker.invalid"})[0] == 404
        status, output = request("POST", "/api/packages/r/install",
                                 "stats", accepted_headers)
        assert status == 200 and "already installed" in output, (status, output)
        status, output = request("POST", "/api/packages/r/install",
                                 "stats;stop('unsafe')", accepted_headers)
        assert status == 422 and "Invalid R package name" in output, (status, output)
        # Updates are explicit and cannot overwrite system libraries or execute
        # injected expressions. Public CRAN network access is not assumed in CI.
        assert request("POST", "/api/packages/r/update", "stats")[0] == 404
        assert request("POST", "/api/packages/r/update", "stats",
                       {"X-FlowStudio-Intent": "run",
                        "Origin": "http://attacker.invalid"})[0] == 404
        status, output = request("POST", "/api/packages/r/update", "stats", accepted_headers)
        assert status == 422 and "system packages cannot be updated" in output, (status, output)
        status, output = request("POST", "/api/packages/r/update",
                                 "stats;stop('unsafe')", accepted_headers)
        assert status == 422 and "Invalid R package name" in output, (status, output)
        # Removal cannot touch system libraries or evaluate arbitrary source.
        assert request("POST", "/api/packages/r/remove", "stats")[0] == 404
        assert request("POST", "/api/packages/r/remove", "stats",
                       {"X-FlowStudio-Intent": "run",
                        "Origin": "http://attacker.invalid"})[0] == 404
        status, output = request("POST", "/api/packages/r/remove",
                                 "stats", accepted_headers)
        assert status == 422 and "system packages cannot be removed" in output, (status, output)
        status, output = request("POST", "/api/packages/r/remove",
                                 "stats;stop('unsafe')", accepted_headers)
        assert status == 422 and "Invalid R package name" in output, (status, output)
        status, output = request("POST", "/api/run/r",
                                 "cat(flowstudio_r_value)", accepted_headers)
        assert status == 200 and output.strip() == "42", (status, output)
        # Real native R graphics are produced by the persistent Rscript
        # device, then retrieved through a separate Flow-owned JSON route.
        assert request("POST", "/api/plot/r", "")[0] == 404
        assert request("POST", "/api/plot/r", "",
                       {"X-FlowStudio-Intent": "run",
                        "Origin": "http://attacker.invalid"})[0] == 404
        status, output = request("POST", "/api/run/r",
                                 "plot(c(1, 2, 3))", accepted_headers)
        assert status == 200, (status, output)
        status, plot_json = request("POST", "/api/plot/r", "", accepted_headers)
        assert status == 200, (status, plot_json[:120])
        captured = json.loads(plot_json)
        assert captured["warning"] is None, captured
        if captured["svg"] is not None:
            assert "<svg" in captured["svg"] and "</svg>" in captured["svg"], captured
            assert captured["pdf"] is None, captured
        else:
            assert bytes.fromhex(captured["pdf"]).startswith(b"%PDF"), captured
        status, output = request("POST", "/api/run/r",
                                 "cat('text only\\n')", accepted_headers)
        assert status == 200, (status, output)
        status, plot_json = request("POST", "/api/plot/r", "", accepted_headers)
        assert status == 200 and json.loads(plot_json)["svg"] is None and json.loads(plot_json)["pdf"] is None, (status, plot_json)
        status, _ = request("POST", "/api/inspect/r", "")
        assert status == 404, status
        status, output = request("POST", "/api/run/r",
                                 'stop("expected native R error")', accepted_headers)
        assert status == 422 and "expected native R error" in output, (status, output)
        status, output = request("POST", "/api/run/r",
                                 'cat(flowstudio_r_value, "\\n")', accepted_headers)
        assert status == 200 and output.strip() == "42", (status, output)
        # Full production Flow HTTP -> persistent CPython -> Rscript -> R plot
        # acceptance. The independent R oracle verifies every Fourier cell,
        # rejects a corrupted transfer, and survives the failed evaluation.
        verify_spectral_interop(request, accepted_headers)

        # The production notebook controller executes mixed Flow/Python/R cells
        # through this running Flow-owned server. Assert real numerics, graphics,
        # portable .fsnb restoration, persistent kernels and fail-closed limits.
        notebook = subprocess.run(
            ["node", str(Path(__file__).with_name("native_mixed_notebook_http.cjs"))],
            cwd=Path(__file__).resolve().parents[1], capture_output=True,
            text=True, timeout=90, check=False,
        )
        assert notebook.returncode == 0, (
            "real mixed-language notebook", notebook.returncode,
            notebook.stdout[-2000:], notebook.stderr[-4000:],
        )
        print(notebook.stdout.strip())

        status, output = request("POST", "/api/reset/r", "", accepted_headers)
        assert status == 200 and "reset" in output, (status, output)
        status, snapshot = request("POST", "/api/inspect/r", "", accepted_headers)
        assert status == 200 and json.loads(snapshot)["variables"] == [], (status, snapshot)
        status, output = request("POST", "/api/run/r",
                                 'cat(exists("flowstudio_r_value", inherits=FALSE), "\\n")',
                                 accepted_headers)
        assert status == 200 and output.strip() == "FALSE", (status, output)
        status, _ = request("POST", "/api/reset/r", "")
        assert status == 404, status
    else:
        print("SKIP native R persistence: Rscript is not installed")

    if shutil.which("flow"):
        code = 'function main() -> i32 {\n    println("flowstudio-flow-ok")\n    return 0\n}\n'
        status, output = request("POST", "/api/run/flow",
                                 code, accepted_headers)
        assert status == 200 and "flowstudio-flow-ok" in output, (status, output)

        # Strict Flow-to-C compilation must never execute the submitted program.
        check_source = ('function main() -> i32 {\n'
                        '    println("THIS-MUST-NOT-EXECUTE")\n'
                        '    return 0\n}\n')
        status, output = request("POST", "/api/check/flow",
                                 check_source, accepted_headers)
        assert status == 200 and "THIS-MUST-NOT-EXECUTE" not in output, (status, output)
        status, output = request("POST", "/api/check/flow",
                                 "function main( -> i32 {", accepted_headers)
        assert status == 422 and output.strip(), (status, output)

        # The MLIR backend bundles stdlib imports under a flow.toml it finds
        # above the staged program; backend runs must get that staging. The
        # route reports a missing local LLVM install itself, which skips
        # this regression on machines without './flow install'.
        mlir_source = ('import std.io { io_read_text }\n'
                       'function main() -> i32 {\n'
                       '    let r: FileRead = io_read_text("/etc/hosts")\n'
                       '    if r.ok == false { print("missing"); return 1 }\n'
                       '    print("flowstudio-mlir-ok")\n'
                       '    return 0\n'
                       '}\n')
        status, output = request("POST", "/api/run/flow-mlir",
                                 mlir_source, accepted_headers)
        if status == 422 and "MLIR tools not found" in output:
            print("SKIP Flow MLIR backend: run './flow install' for local LLVM tooling")
        else:
            assert status == 200 and "flowstudio-mlir-ok" in output, (status, output)
    else:
        print("SKIP Flow subprocess: executable not on PATH")

    print("PASS: localhost HTTP, editor, intent controls, limits, runtimes")


if __name__ == "__main__":
    main()
