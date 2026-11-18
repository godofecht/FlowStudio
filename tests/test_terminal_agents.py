"""The Terminal's claude and codex wrappers (mcp/terminal).

Each test puts a fake `claude` or `codex` on PATH that writes its argv to a
file and exits. No model starts and nothing is billed. The wrappers must
add the FlowStudio MCP server, pass every user argument through in order,
never run themselves again, and fail like a shell when the real CLI is
missing.

Run: python3 tests/test_terminal_agents.py
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import tomllib
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BIN = os.path.join(ROOT, "mcp", "terminal", "bin")
ZSH = os.path.join(ROOT, "mcp", "terminal", "zsh")
BASH_RC = os.path.join(ROOT, "mcp", "terminal", "bash", "rc")
SERVER = os.path.join(ROOT, "mcp", "flowstudio_mcp.py")
SYSTEM_PATH = "/usr/bin:/bin:/usr/sbin:/sbin"

FAKE = """#!/bin/sh
python3 -c 'import json, sys; print(json.dumps(sys.argv[1:]))' "$@" >> "{log}"
exit 0
"""


class WrapperTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.mkdtemp(prefix="fs-agents-")
        self.fake_dir = os.path.join(self.tmp, "real bin")
        os.mkdir(self.fake_dir)
        self.log = os.path.join(self.tmp, "argv.log")

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def fake(self, name: str, directory: str | None = None) -> str:
        path = os.path.join(directory or self.fake_dir, name)
        with open(path, "w") as handle:
            handle.write(FAKE.format(log=self.log))
        os.chmod(path, 0o755)
        return path

    def run_wrapper(self, name: str, args: list[str], path: str, env_extra: dict | None = None,
                    mcp: bool = True) -> subprocess.CompletedProcess:
        env = {"PATH": path, "HOME": self.tmp}
        if mcp:
            env["FLOWSTUDIO_URL"] = "http://127.0.0.1:8925"
            env["FLOWSTUDIO_MCP"] = SERVER
        env.update(env_extra or {})
        return subprocess.run([os.path.join(BIN, name), *args], env=env, capture_output=True,
                              text=True, timeout=20)

    def calls(self) -> list[list[str]]:
        if not os.path.exists(self.log):
            return []
        with open(self.log) as handle:
            return [json.loads(line) for line in handle if line.strip()]

    def test_claude_gets_the_mcp_config_and_every_argument(self) -> None:
        self.fake("claude")
        user = ["-p", "two words", "--model", "x", "it's \"quoted\"", "--", "-c"]
        result = self.run_wrapper("claude", user, f"{BIN}:{self.fake_dir}:{SYSTEM_PATH}")
        self.assertEqual(result.returncode, 0, result.stderr)
        [argv] = self.calls()
        self.assertTrue(argv[0].startswith("--mcp-config="), argv)
        self.assertEqual(argv[1:], user)
        config = json.loads(argv[0].split("=", 1)[1])
        server = config["mcpServers"]["flowstudio"]
        self.assertEqual(server["type"], "stdio")
        self.assertEqual(server["args"], [SERVER])
        self.assertEqual(server["env"], {"FLOWSTUDIO_URL": "http://127.0.0.1:8925"})
        self.assertTrue(os.path.basename(server["command"]).startswith("python3"), server)

    def test_codex_gets_config_overrides_that_parse_as_toml(self) -> None:
        self.fake("codex")
        user = ["exec", "two words"]
        result = self.run_wrapper("codex", user, f"{BIN}:{self.fake_dir}:{SYSTEM_PATH}")
        self.assertEqual(result.returncode, 0, result.stderr)
        [argv] = self.calls()
        self.assertEqual(argv[-2:], user)
        overrides = argv[:-2]
        self.assertEqual(overrides[0::2], ["-c", "-c", "-c"])
        parsed: dict = {}
        for item in overrides[1::2]:
            key, value = item.split("=", 1)
            parsed[key] = tomllib.loads("v = " + value)["v"]
        self.assertEqual(parsed["mcp_servers.flowstudio.args"], [SERVER])
        self.assertEqual(parsed["mcp_servers.flowstudio.env"], {"FLOWSTUDIO_URL": "http://127.0.0.1:8925"})
        self.assertTrue(os.path.basename(parsed["mcp_servers.flowstudio.command"]).startswith("python3"))

    def test_odd_characters_in_paths_stay_valid_json(self) -> None:
        self.fake("claude")
        odd = os.path.join(self.tmp, 'dir "with" back\\slash')
        os.mkdir(odd)
        server = os.path.join(odd, "flowstudio_mcp.py")
        shutil.copy(SERVER, server)
        result = self.run_wrapper("claude", [], f"{BIN}:{self.fake_dir}:{SYSTEM_PATH}",
                                  {"FLOWSTUDIO_MCP": server})
        self.assertEqual(result.returncode, 0, result.stderr)
        [argv] = self.calls()
        config = json.loads(argv[0].split("=", 1)[1])
        self.assertEqual(config["mcpServers"]["flowstudio"]["args"], [server])

    def test_without_a_flowstudio_server_arguments_pass_through_unchanged(self) -> None:
        self.fake("claude")
        result = self.run_wrapper("claude", ["--version"], f"{BIN}:{self.fake_dir}:{SYSTEM_PATH}", mcp=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.calls(), [["--version"]])

    def test_the_wrapper_never_runs_itself(self) -> None:
        # The wrapper directory twice, a symlinked alias of it, and a copy of
        # the wrapper elsewhere all come before the real binary.
        alias = os.path.join(self.tmp, "alias")
        os.symlink(BIN, alias)
        copy = os.path.join(self.tmp, "copy")
        os.mkdir(copy)
        shutil.copy(os.path.join(BIN, "claude"), os.path.join(copy, "claude"))
        shutil.copy(os.path.join(ROOT, "mcp", "terminal", "agent_wrapper.sh"), os.path.join(self.tmp, "agent_wrapper.sh"))
        self.fake("claude")
        path = f"{BIN}:{alias}:{BIN}:{copy}:{self.fake_dir}:{SYSTEM_PATH}"
        result = self.run_wrapper("claude", ["hello"], path)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(self.calls()), 1)
        self.assertEqual(self.calls()[0][-1], "hello")

    def test_missing_real_binary_fails_like_a_shell(self) -> None:
        for name in ("claude", "codex"):
            with self.subTest(name=name):
                result = self.run_wrapper(name, ["x"], f"{BIN}:{BIN}:{SYSTEM_PATH}")
                self.assertEqual(result.returncode, 127)
                self.assertIn(f"{name}: command not found", result.stderr)
                self.assertEqual(self.calls(), [])


@unittest.skipUnless(shutil.which("zsh"), "zsh is not installed")
class ZshStartupTest(unittest.TestCase):
    """A login zsh with ZDOTDIR on the shim runs the user's own files and
    still finds the wrapper first, even when .zshrc prepends another claude."""

    def test_user_files_run_and_the_wrapper_stays_first(self) -> None:
        with tempfile.TemporaryDirectory(prefix="fs-zsh-") as home:
            other = os.path.join(home, "other")
            os.mkdir(other)
            with open(os.path.join(other, "claude"), "w") as handle:
                handle.write("#!/bin/sh\nexit 0\n")
            os.chmod(os.path.join(other, "claude"), 0o755)
            with open(os.path.join(home, ".zshenv"), "w") as handle:
                handle.write("export FS_ZSHENV=1\n")
            with open(os.path.join(home, ".zshrc"), "w") as handle:
                handle.write(f"export FS_ZSHRC=1\npath=({other} $path)\n")
            env = {"HOME": home, "PATH": f"{BIN}:{SYSTEM_PATH}", "ZDOTDIR": ZSH, "TERM": "dumb",
                   "FLOWSTUDIO_TERMINAL_BIN": BIN}
            # /etc/zshrc may set HISTFILE from ZDOTDIR; history must not land in the shim folder.
            script = 'print -r -- "$FS_ZSHENV $FS_ZSHRC|$(whence -p claude)|${ZDOTDIR-unset}|${HISTFILE-none}"'
            result = subprocess.run(["zsh", "-l", "-i", "-c", script], env=env, capture_output=True,
                                    text=True, timeout=20, stdin=subprocess.DEVNULL)
            line = result.stdout.strip().splitlines()[-1]
            fields = line.split("|")
            self.assertEqual(fields[:3], ["1 1", f"{BIN}/claude", "unset"], result.stderr)
            self.assertFalse(fields[3].startswith(ZSH), fields[3])


@unittest.skipUnless(shutil.which("bash"), "bash is not installed")
class BashStartupTest(unittest.TestCase):
    def test_login_files_run_and_the_wrapper_stays_first(self) -> None:
        with tempfile.TemporaryDirectory(prefix="fs-bash-") as home:
            other = os.path.join(home, "other")
            os.mkdir(other)
            with open(os.path.join(home, ".bash_profile"), "w") as handle:
                handle.write(f"export FS_PROFILE=1\nPATH={other}:$PATH\n")
            env = {"HOME": home, "PATH": f"{BIN}:{SYSTEM_PATH}", "TERM": "dumb",
                   "FLOWSTUDIO_TERMINAL_BIN": BIN}
            script = 'echo "$FS_PROFILE|${PATH%%:*}"'
            result = subprocess.run(["bash", "--rcfile", BASH_RC, "-i", "-c", script], env=env,
                                    capture_output=True, text=True, timeout=20, stdin=subprocess.DEVNULL)
            line = result.stdout.strip().splitlines()[-1]
            self.assertEqual(line, f"1|{BIN}", result.stderr)


if __name__ == "__main__":
    unittest.main()
