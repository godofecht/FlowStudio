"""Exercise the real Rscript-backed IPC transport, not a mocked interpreter."""
from pathlib import Path
import os
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


@unittest.skipUnless(shutil.which("Rscript"), "Rscript is not installed")
class NativeRSessionTest(unittest.TestCase):
    def test_persistent_r_kernel(self):
        with tempfile.TemporaryDirectory(prefix="flowstudio-r-kernel-") as temp:
            binary = Path(temp) / "session-harness"
            subprocess.run([
                "cc", "-std=c11", "-Wall", "-Wextra", "-Werror", "-O2",
                str(ROOT / "src/r_session.c"),
                str(ROOT / "tests/r_session_harness.c"),
                "-o", str(binary),
            ], cwd=ROOT, check=True, capture_output=True, text=True, timeout=30)
            # Build a genuine minimal source package and local CRAN repository.
            # This verifies install.packages() and namespace loading without
            # depending on external mirrors or mocking the R interpreter.
            package = Path(temp) / "FlowStudioFixture"
            (package / "R").mkdir(parents=True)
            (package / "DESCRIPTION").write_text(
                "Package: FlowStudioFixture\n"
                "Version: 0.0.1\n"
                "Title: FlowStudio Native R Installation Fixture\n"
                "Description: Minimal offline fixture for real CRAN-style installation.\n"
                "Authors@R: person('Flow', 'Studio', email='flowstudio@example.org', role=c('aut','cre'))\n"
                "License: MIT\n"
                "Encoding: UTF-8\n",
                encoding="utf-8")
            (package / "NAMESPACE").write_text("export(answer)\n", encoding="utf-8")
            (package / "R" / "answer.R").write_text(
                "answer <- function() 42L\n", encoding="utf-8")
            built = subprocess.run(
                ["R", "CMD", "build", "--no-build-vignettes", str(package)],
                cwd=temp, check=False, capture_output=True, text=True, timeout=30)
            self.assertEqual(built.returncode, 0, built.stdout + built.stderr)
            self.assertIn("FlowStudioFixture", built.stdout + built.stderr)
            archive = Path(temp) / "FlowStudioFixture_0.0.1.tar.gz"
            self.assertTrue(archive.is_file(), built.stdout + built.stderr)
            mirror = Path(temp) / "cran" / "src" / "contrib"
            mirror.mkdir(parents=True)
            shutil.move(str(archive), str(mirror / archive.name))
            environment = os.environ.copy()
            environment["HOME"] = str(Path(temp))
            environment["XDG_DATA_HOME"] = str(Path(temp) / "xdg-data")
            environment["FLOWSTUDIO_R_TEST_MODE"] = "1"
            environment["FLOWSTUDIO_R_TEST_REPO"] = (Path(temp) / "cran").as_uri()
            subprocess.run(
                ["Rscript", "-e", "tools::write_PACKAGES(Sys.getenv('FLOWSTUDIO_R_TEST_REPO_PATH'), type='source')"],
                cwd=ROOT, env={**environment, "FLOWSTUDIO_R_TEST_REPO_PATH": str(mirror)},
                check=True, capture_output=True, text=True, timeout=20)
            first_index = (mirror / "PACKAGES").read_bytes()
            description = package / "DESCRIPTION"
            description.write_text(description.read_text(encoding="utf-8").replace(
                "Version: 0.0.1", "Version: 0.0.2"), encoding="utf-8")
            (package / "R" / "answer.R").write_text(
                "answer <- function() 43L\n", encoding="utf-8")
            next_build = subprocess.run(
                ["R", "CMD", "build", "--no-build-vignettes", str(package)],
                cwd=temp, check=False, capture_output=True, text=True, timeout=30)
            self.assertEqual(next_build.returncode, 0, next_build.stdout + next_build.stderr)
            next_archive = Path(temp) / "FlowStudioFixture_0.0.2.tar.gz"
            self.assertTrue(next_archive.is_file(), next_build.stdout + next_build.stderr)
            shutil.move(str(next_archive), str(mirror / next_archive.name))
            subprocess.run(
                ["Rscript", "-e", "tools::write_PACKAGES(Sys.getenv('FLOWSTUDIO_R_TEST_REPO_PATH'), type='source')"],
                cwd=ROOT, env={**environment, "FLOWSTUDIO_R_TEST_REPO_PATH": str(mirror)},
                check=True, capture_output=True, text=True, timeout=20)
            next_index = mirror / "PACKAGES.next"
            next_index.write_bytes((mirror / "PACKAGES").read_bytes())
            (mirror / "PACKAGES").write_bytes(first_index)
            # Force available.packages(cacheOK=FALSE) to read the index switched
            # by the harness, not a stale compressed index.
            for suffix in ("PACKAGES.gz", "PACKAGES.rds"):
                (mirror / suffix).unlink(missing_ok=True)
            environment["FLOWSTUDIO_R_TEST_PACKAGES_NEXT"] = str(next_index)
            environment["FLOWSTUDIO_R_TEST_PACKAGES_CURRENT"] = str(mirror / "PACKAGES")
            result = subprocess.run([str(binary)], cwd=ROOT, capture_output=True,
                                    env=environment, text=True, timeout=55, check=False)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn("PASS: native persistent R", result.stdout)
