"""Production Flow/R/Python HTTP verification of the seeded 3D coupled volume.

Native Flow's 1,024 final voxels are compared to independent vectorized base R
and a separate Python direct-stencil kernel, including 64 intermediate energies.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

from test_native_coupled_volume8_oracle import seeded_initial, sparse_oracle, spatial_energy

ROOT = Path(__file__).resolve().parents[1]
MARKER = "FLOWSTUDIO_VOLUME_R_V1 "
ENERGY_MARKER = "FLOWSTUDIO_VOLUME_R_ENERGY_V1 "
MAX_SOURCE_BYTES = 128 * 1024
MAX_RESPONSE_BYTES = 40 * 1024


def _python_verifier(values: list[float], energies: list[float]) -> str:
    payload = json.dumps({"values": values, "energies": energies},
                         allow_nan=False, separators=(",", ":"))
    source = (
        "import json, math\n"
        "volume_frame = json.loads(" + repr(payload) + ")\n"
        "volume_values = volume_frame['values']\n"
        "volume_energies = volume_frame['energies']\n"
        "assert len(volume_values) == 1024 and all(isinstance(v, (int,float)) and math.isfinite(v) for v in volume_values), 'volume frame invalid'\n"
        "assert len(volume_energies) == 64 and all(isinstance(v, (int,float)) and math.isfinite(v) for v in volume_energies), 'volume energy frame invalid'\n"
        "coords = [(x,y,z) for z in range(8) for y in range(8) for x in range(8)]\n"
        "def position(x,y,z): return (x%8)+8*(y%8)+64*(z%8)\n"
        "u = []; v = []\n"
        "for x,y,z in coords:\n"
        "    r = (9137+71*x+113*y+157*z+17*x*y+19*y*z+23*z*x)%251\n"
        "    u.append(30+.1*r); v.append(10+.07*((3*r+41)%251))\n"
        "coeff = ((.10,.08,.06),(.04,.07,.05))\n"
        "for step in range(64):\n"
        "    diffused = ([],[])\n"
        "    for i,(x,y,z) in enumerate(coords):\n"
        "        for species,field in enumerate((u,v)):\n"
        "            delta = 0.0\n"
        "            for axis,amount in enumerate(coeff[species]):\n"
        "                left = [x,y,z]; right = [x,y,z]\n"
        "                left[axis] -= 1; right[axis] += 1\n"
        "                delta += amount*(field[position(*left)]+field[position(*right)]-2*field[i])\n"
        "            diffused[species].append(field[i]+.20*delta)\n"
        "    u = [.97*a+.03*b for a,b in zip(*diffused)]\n"
        "    v = [.03*a+.97*b for a,b in zip(*diffused)]\n"
        "    energy = sum((value-sum(field)/512)**2 for field in (u,v) for value in field)\n"
        "    assert abs(energy-volume_energies[step]) < 1e-7, 'volume energy mismatch'\n"
        "assert max(abs(a-b) for a,b in zip(u+v,volume_values)) < 2e-10, 'volume field mismatch'\n"
        "print('volume8-r-python-oracle-ok')\n"
    )
    # Keep oracle variables local: bounded environment inspection must not
    # evict unrelated persistent user variables after numerical acceptance.
    source = ("def flowstudio_volume8_check():\n" +
              "".join("    " + line for line in source.splitlines(keepends=True)) +
              "try:\n    flowstudio_volume8_check()\nfinally:\n    del flowstudio_volume8_check\n")
    assert len(source.encode("utf-8")) < MAX_SOURCE_BYTES
    return source


def verify_volume8_interop(request, headers: dict[str, str],
                           native_fields: tuple[list[float], list[float]]) -> None:
    source = (ROOT / "examples/coupled_volume8_r.R").read_text(encoding="utf-8")
    assert len(source.encode("utf-8")) < MAX_SOURCE_BYTES
    assert len(native_fields) == 2 and all(len(field) == 512 for field in native_fields)
    status, body = request("POST", "/api/run/r", source, headers)
    assert status == 200, ("real R 3D diffusion", status, body[:500])
    assert len(body.encode("utf-8")) < MAX_RESPONSE_BYTES
    frames = [line[len(MARKER):] for line in body.splitlines() if line.startswith(MARKER)]
    traces = [line[len(ENERGY_MARKER):] for line in body.splitlines()
              if line.startswith(ENERGY_MARKER)]
    assert len(frames) == len(traces) == 1, ("R volume frame count", len(frames), len(traces))
    values = [float(v) for v in frames[0].split(",")]
    energies = [float(v) for v in traces[0].split(",")]
    assert len(values) == 1024 and len(energies) == 64
    assert all(math.isfinite(v) for v in values + energies)
    expected = sparse_oracle(seeded_initial(), 64)
    for species in range(2):
        observed = values[species * 512:(species + 1) * 512]
        assert max(abs(a-b) for a,b in zip(observed, expected[species])) < 2e-10, (
            "R vs independent Python sparse 3D oracle", species)
        assert max(abs(a-b) for a,b in zip(observed, native_fields[species])) < .002, (
            "R vs real Flow compiled 3D voxels", species)
    current = seeded_initial()
    for step, observed_energy in enumerate(energies, start=1):
        current = sparse_oracle(current, 1)
        assert abs(spatial_energy(current) - observed_energy) < 1e-7, (
            "R vs independent Python sparse energy", step)

    def check_python(field_values, trace):
        return request("POST", "/api/run/python", _python_verifier(field_values, trace), headers)

    status, body = check_python(values, energies)
    assert status == 200 and "volume8-r-python-oracle-ok" in body, (
        "real Python direct 3D stencil", status, body[:500])
    corrupted = values[:]
    corrupted[511] += 0.25
    status, body = check_python(corrupted, energies)
    assert status == 422 and "volume field mismatch" in body, (
        "finite mass-changing voxel corruption", status, body[:500])
    corrupted_trace = energies[:]
    corrupted_trace[31] += 1.0
    status, body = check_python(values, corrupted_trace)
    assert status == 422 and "volume energy mismatch" in body, (
        "intermediate energy corruption", status, body[:500])
    status, body = check_python(values[:-1], energies)
    assert status == 422 and "volume frame invalid" in body, (
        "truncated R volume frame", status, body[:500])
    status, body = request("POST", "/api/run/r",
                           "flowstudio_volume_step(flowstudio_volume_state, ratio=0.51)", headers)
    assert status == 422 and "volume coefficients invalid" in body, (
        "real R unstable ratio rejection", status, body[:500])
    status, body = request("POST", "/api/run/r",
                           "stopifnot(length(flowstudio_volume_state$u)==512L, "
                           "length(flowstudio_volume_state$v)==512L, "
                           "identical(flowstudio_volume_state,flowstudio_volume_replay)); "
                           "cat('volume-r-persistent-ok\\n')", headers)
    assert status == 200 and "volume-r-persistent-ok" in body, (
        "R checkpoint state after negative", status, body[:500])
    status, body = check_python(values, energies)
    assert status == 200 and "volume8-r-python-oracle-ok" in body, (
        "Python recovery after numerical 422", status, body[:500])
    print("PASS: native Flow 1024 voxels vs real base R and Python direct/sparse "
          "3D stencils, 64 energies, 32+32 restart, corruption HTTP 422")
