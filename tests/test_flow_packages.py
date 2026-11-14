"""Flow project dependencies (src/flow_packages.py) and Flow plots
(src/flowstudio.flow).

Offline: request parsing, add argument mapping, manifest editing and
remove, with a stand-in `flow` command on PATH that records its arguments.
With the real flow on PATH: init, add --path and remove on a temporary
project, and plot, scatter and hist printing bounded SVG frames.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "src"))

import flow_packages as fp  # noqa: E402

MANIFEST = """[package]
name = "demo"
version = "0.1.0"

[dependencies]
mylib = { path = "../mylib" }
mathx = "1.2.0"

[dev-dependencies]
testkit = "0.1.0"

[build]
host = "flowc"
"""

FAKE_FLOW = """#!/bin/sh
echo "$@" >> "$FAKE_FLOW_LOG"
printf '\\033[92m\\342\\234\\223 ok\\033[0m\\n'
"""


class Helper(unittest.TestCase):
    def setUp(self):
        self.base = tempfile.mkdtemp(prefix="flowstudio-pkg-test-")
        self.project = os.path.realpath(os.path.join(self.base, "demo"))
        os.makedirs(os.path.join(self.project, "flow_packages", "mylib"))
        with open(os.path.join(self.project, "flow.toml"), "w", encoding="utf-8") as handle:
            handle.write(MANIFEST)
        with open(os.path.join(self.project, "flow.lock"), "w", encoding="utf-8") as handle:
            json.dump({"version": 1, "packages": {"mylib": {"version": {"path": "../mylib"}, "source": "path"},
                                                  "mathx": {"version": "1.2.0", "source": "registry"}}}, handle)
        bin_dir = os.path.join(self.base, "bin")
        os.makedirs(bin_dir)
        fake = os.path.join(bin_dir, "flow")
        with open(fake, "w", encoding="utf-8") as handle:
            handle.write(FAKE_FLOW)
        os.chmod(fake, os.stat(fake).st_mode | stat.S_IEXEC)
        self.log = os.path.join(self.base, "flow.log")
        self.saved = {key: os.environ.get(key) for key in ("PATH", "FAKE_FLOW_LOG")}
        os.environ["PATH"] = bin_dir + os.pathsep + os.environ.get("PATH", "")
        os.environ["FAKE_FLOW_LOG"] = self.log

    def tearDown(self):
        for key, value in self.saved.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        shutil.rmtree(self.base, ignore_errors=True)

    def calls(self) -> list[str]:
        try:
            with open(self.log, encoding="utf-8") as handle:
                return handle.read().splitlines()
        except OSError:
            return []

    def test_list_reads_manifest_lock_and_installed_copies(self):
        status, data = fp.handle("list", self.project)
        self.assertEqual(status, 0)
        self.assertTrue(data["ok"])
        self.assertTrue(data["manifest"])
        self.assertEqual(data["name"], "demo")
        rows = {row["name"]: row for row in data["dependencies"]}
        self.assertEqual(set(rows), {"mylib", "mathx", "testkit"})
        self.assertEqual(rows["mylib"]["source"], "path")
        self.assertEqual(rows["mylib"]["spec"], "../mylib")
        self.assertTrue(rows["mylib"]["installed"])
        self.assertEqual(rows["mathx"]["locked"], "1.2.0")
        self.assertFalse(rows["mathx"]["installed"])
        self.assertTrue(rows["testkit"]["dev"])
        self.assertEqual(self.calls(), [], "listing never runs flow")

    def test_folder_must_be_an_existing_absolute_directory(self):
        for folder in ("", "relative/path", os.path.join(self.base, "missing"), "/"):
            status, data = fp.handle("list", folder)
            self.assertEqual(status, 2, folder)
            self.assertFalse(data["ok"])
        self.assertEqual(fp.handle("format-disk", self.project)[0], 2)

    def test_add_maps_specs_to_flow_add_arguments(self):
        library = os.path.join(self.base, "tinylib")
        os.makedirs(library)
        with open(os.path.join(library, "flow.toml"), "w", encoding="utf-8") as handle:
            handle.write('[package]\nname = "tiny_lib"\n')
        self.assertEqual(fp.add_args(self.project, library), ["add", "--path", library, "--name", "tiny_lib"])
        self.assertEqual(fp.add_args(self.project, "../tinylib"), ["add", "--path", "../tinylib", "--name", "tiny_lib"])
        self.assertEqual(fp.add_args(self.project, "json@^1.0"), ["add", "json@^1.0"])
        self.assertEqual(fp.add_args(self.project, "https://github.com/a/b.git"),
                         ["add", "--git", "https://github.com/a/b.git"])
        for bad in ("--name=x", "-v", "a b", "x;rm -rf /", ""):
            with self.assertRaises(fp.Refused, msg=bad):
                fp.add_args(self.project, bad)
        with self.assertRaises(fp.Refused):
            fp.add_args(self.project, "./missing-folder")

    def test_add_runs_flow_in_the_project_folder(self):
        status, data = fp.handle("add", self.project + "\njson@1.0")
        self.assertEqual(status, 0)
        self.assertTrue(data["ok"], data)
        self.assertEqual(self.calls(), ["add json@1.0"])
        self.assertIn("$ flow add json@1.0", data["output"])
        self.assertNotIn("\x1b", data["output"], "colour codes are removed")

    def test_red_output_marks_a_failure(self):
        with open(os.path.join(self.base, "bin", "flow"), "w", encoding="utf-8") as handle:
            handle.write("#!/bin/sh\nprintf '\\033[91mPackage not found\\033[0m\\n'\n")
        status, data = fp.handle("add", self.project + "\nnosuch")
        self.assertEqual(status, 0)
        self.assertFalse(data["ok"])
        self.assertIn("Package not found", data["output"])

    def test_remove_edits_manifest_lock_and_packages_then_syncs(self):
        status, data = fp.handle("remove", self.project + "\nmylib")
        self.assertEqual(status, 0)
        self.assertTrue(data["ok"], data)
        with open(os.path.join(self.project, "flow.toml"), encoding="utf-8") as handle:
            manifest = handle.read()
        self.assertNotIn("mylib", manifest)
        self.assertIn('mathx = "1.2.0"', manifest)
        self.assertIn("[build]", manifest)
        with open(os.path.join(self.project, "flow.lock"), encoding="utf-8") as handle:
            self.assertEqual(set(json.load(handle)["packages"]), {"mathx"})
        self.assertFalse(os.path.exists(os.path.join(self.project, "flow_packages", "mylib")))
        self.assertEqual(self.calls(), ["sync"])
        self.assertEqual([row["name"] for row in data["dependencies"]], ["mathx", "testkit"])

    def test_remove_refuses_unknown_and_unsafe_names(self):
        for name in ("absent", "../evil", "--all", ""):
            status, data = fp.handle("remove", self.project + "\n" + name)
            self.assertEqual(status, 2, name)
        self.assertEqual(self.calls(), [])

    def test_remove_handles_a_dependency_table(self):
        text = '[dependencies]\nkeep = "1"\n\n[dependencies.gone]\ngit = "https://x/y.git"\ntag = "v1"\n\n[build]\nhost = "flowc"\n'
        updated, removed = fp.drop_from_manifest(text, "gone")
        self.assertTrue(removed)
        self.assertNotIn("gone", updated)
        self.assertNotIn("tag =", updated)
        self.assertIn('keep = "1"', updated)
        self.assertIn('host = "flowc"', updated)

    def test_simple_parser_matches_tomllib_on_flow_manifests(self):
        parsed = fp.parse_simple_toml(MANIFEST)
        self.assertEqual(parsed["dependencies"]["mylib"], {"path": "../mylib"})
        self.assertEqual(parsed["dependencies"]["mathx"], "1.2.0")
        self.assertEqual(parsed["package"]["name"], "demo")

    def test_init_refuses_an_existing_manifest(self):
        status, data = fp.handle("init", self.project)
        self.assertEqual(status, 2)
        self.assertIn("already has a flow.toml", data["output"])


REAL_FLOW = shutil.which("flow")


@unittest.skipUnless(REAL_FLOW, "flow is not on PATH")
class RealFlow(unittest.TestCase):
    def test_init_add_path_and_remove(self):
        base = tempfile.mkdtemp(prefix="flowstudio-pkg-real-")
        try:
            project = os.path.join(base, "demo")
            library = os.path.join(base, "tinylib")
            os.makedirs(project)
            os.makedirs(os.path.join(library, "src"))
            with open(os.path.join(library, "flow.toml"), "w", encoding="utf-8") as handle:
                handle.write('[package]\nname = "tinylib"\nversion = "0.3.0"\n')
            with open(os.path.join(library, "src", "main.flow"), "w", encoding="utf-8") as handle:
                handle.write("export function seven() -> i32 {\n    return 7\n}\n")
            status, data = fp.handle("init", project)
            self.assertEqual((status, data["ok"], data["manifest"]), (0, True, True), data)
            status, data = fp.handle("add", project + "\n" + library)
            self.assertTrue(data["ok"], data)
            self.assertEqual([row["name"] for row in data["dependencies"]], ["tinylib"])
            self.assertTrue(data["dependencies"][0]["installed"])
            status, data = fp.handle("remove", project + "\ntinylib")
            self.assertTrue(data["ok"], data)
            self.assertEqual(data["dependencies"], [])
            self.assertFalse(os.path.exists(os.path.join(project, "flow_packages", "tinylib")))
        finally:
            shutil.rmtree(base, ignore_errors=True)

    def test_plot_scatter_and_hist_print_bounded_svg_frames(self):
        work = tempfile.mkdtemp(prefix="flowstudio-plot-")
        try:
            shutil.copyfile(os.path.join(ROOT, "src", "flowstudio.flow"), os.path.join(work, "flowstudio.flow"))
            program = os.path.join(work, "plots.flow")
            with open(program, "w", encoding="utf-8") as handle:
                handle.write("""import flowstudio { plot, scatter, hist, plot_title, plot_labels }

function main() -> i32 {
    let mut xs: array<f64, 3000> = [0.0; 3000]
    let mut ys: array<f64, 3000> = [0.0; 3000]
    for i in 0..3000 {
        xs[i] = i as f64
        ys[i] = i as f64 * 0.5
    }
    ys[7] = 0.0 / 0.0
    plot_title("A <b> & \\"c\\"")
    plot_labels("x", "y")
    plot(xs, ys)
    scatter(xs, ys)
    hist(ys, 500)
    let one: array<f64, 1> = [2.0]
    plot(one, one)
    return 0
}
""")
            done = subprocess.run([REAL_FLOW, "run", program], cwd=work, capture_output=True, text=True,
                                  timeout=180, check=False)
            self.assertEqual(done.returncode, 0, done.stdout + done.stderr)
            frames = re.findall(r"\x1eFLOWSTUDIO-PLOT\x1e([^\n]*)", done.stdout)
            self.assertEqual(len(frames), 4, done.stdout[-2000:])
            kinds = [re.search(r'data-flow-plot="(\w+)"', frame).group(1) for frame in frames]
            self.assertEqual(kinds, ["line", "scatter", "hist", "line"])
            for frame in frames:
                self.assertTrue(frame.startswith("<svg ") and frame.endswith("</svg>"))
                self.assertLessEqual(len(frame), 60000)
                self.assertNotIn("nan", frame.lower())
            self.assertIn("A &lt;b&gt; &amp; &quot;c&quot;", frames[0], "the title is escaped")
            self.assertNotIn("A &lt;b&gt;", frames[1], "a title applies to one figure")
            # 3000 points are thinned to at most 1000 path commands.
            self.assertLessEqual(frames[0].count("L") + frames[0].count("M"), 1002)
            self.assertLessEqual(frames[2].count("<rect fill=\"#2563eb\""), 100, "bins are capped at 100")
        finally:
            shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
