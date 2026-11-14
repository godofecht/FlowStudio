"""The release archive holds every repository file the server opens.

The server, its C bridges and the browser name these files by relative
path (for example "src/flow_session.py"). A file left out of
scripts/package.sh breaks that feature in the packaged build only, which
no other test sees. This test reads those paths from the sources and
checks them against the newest archive in dist/.

Run after `sh scripts/package.sh`: python3 tests/test_package_contents.py
"""
from __future__ import annotations

import glob
import os
import re
import tarfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCES = ["src/*.flow", "src/*.c", "src/*.py", "web/*.js"]
RUNTIME = re.compile(r'"((?:src|mcp|scripts)/[A-Za-z0-9_./-]+\.[A-Za-z]+)"')


def referenced() -> set[str]:
    found: set[str] = set()
    for pattern in SOURCES:
        for path in glob.glob(os.path.join(ROOT, pattern)):
            with open(path, encoding="utf-8", errors="replace") as handle:
                for name in RUNTIME.findall(handle.read()):
                    if os.path.isfile(os.path.join(ROOT, name)):
                        found.add(name)
    # The assistant finds the MCP server through the working directory.
    found.add("mcp/flowstudio_mcp.py")
    return found


def newest_archive() -> str | None:
    archives = glob.glob(os.path.join(ROOT, "dist", "flowstudio-*.tar.gz"))
    return max(archives, key=os.path.getmtime) if archives else None


class PackageContentsTest(unittest.TestCase):
    def test_sources_name_runtime_files(self) -> None:
        names = referenced()
        for expected in ("src/flow_session.py", "src/flowstudio.flow", "src/flow_quick_run.sh", "src/python_kernel.py"):
            self.assertIn(expected, names)

    @unittest.skipUnless(newest_archive(), "no archive in dist/; run sh scripts/package.sh first")
    def test_archive_holds_every_runtime_file(self) -> None:
        archive = newest_archive()
        with tarfile.open(archive) as tar:
            members = {member.name.split("/", 1)[1] for member in tar.getmembers() if "/" in member.name}
        missing = sorted(name for name in referenced() if name not in members)
        self.assertEqual(missing, [], f"{os.path.basename(archive)} lacks files the server opens")


if __name__ == "__main__":
    unittest.main()
