"""Flow project dependencies for the Packages view.

The native server runs this helper for POST /api/packages/flow and passes
the request body on stdin. The body names an operation, a project folder
and, for add and remove, one argument, one per line:

    list     the [dependencies] of the folder's flow.toml, with what is
             installed under flow_packages/ and pinned in flow.lock
    init     flow init (creates flow.toml, src/main.flow, .gitignore)
    add      flow add NAME[@VERSION] | GIT-URL | --path DIR --name NAME
    remove   drops NAME from flow.toml, flow.lock and flow_packages/,
             then runs flow sync (the Flow CLI has no remove command)
    sync     flow sync

Every reply is JSON: {ok, project, manifest, name, dependencies, output},
where output is the command's text with colour codes removed. The folder
must be an absolute path to an existing directory. Arguments never reach a
shell and never start with a dash, so they cannot become flow options.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys

try:
    import tomllib
except ImportError:  # Python before 3.11
    tomllib = None

OPERATIONS = ("list", "init", "add", "remove", "sync")
NAME = re.compile(r"[A-Za-z_][A-Za-z0-9_.-]{0,63}$")
REGISTRY_SPEC = re.compile(r"[A-Za-z_][A-Za-z0-9_.-]{0,63}(?:@[0-9A-Za-z.*^~<>=+-]{1,40})?$")
GIT_URL = re.compile(r"(?:https://|git@)[A-Za-z0-9._~:/@%+-]{3,300}$")
ANSI = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")
OUTPUT_LIMIT = 16000
TIMEOUT = 240


class Refused(Exception):
    """A request the helper will not run."""


def clean(text: str) -> str:
    text = ANSI.sub("", text).replace("\r\n", "\n")
    return text[-OUTPUT_LIMIT:]


def project_dir(raw: str) -> str:
    path = raw.strip()
    if not path:
        raise Refused("Choose a project folder first.")
    path = os.path.expanduser(path)
    if not os.path.isabs(path):
        raise Refused("The project folder must be an absolute path.")
    real = os.path.realpath(path)
    if real == os.path.sep or not os.path.isdir(real):
        raise Refused("The project folder does not exist: " + path)
    return real


def manifest_path(project: str) -> str:
    return os.path.join(project, "flow.toml")


def read_manifest(project: str) -> dict | None:
    path = manifest_path(project)
    if not os.path.isfile(path):
        return None
    with open(path, encoding="utf-8") as handle:
        text = handle.read()
    if tomllib is not None:
        try:
            return tomllib.loads(text)
        except ValueError as error:
            raise Refused("flow.toml does not parse: " + str(error)) from error
    return parse_simple_toml(text)


def parse_simple_toml(text: str) -> dict:
    """Tables, strings and one-line inline tables: enough for flow.toml."""
    data: dict = {}
    table = data
    for raw in text.splitlines():
        line = raw.split("#", 1)[0].strip() if not raw.strip().startswith("#") else ""
        if not line:
            continue
        header = re.match(r"\[([^\]]+)\]$", line)
        if header:
            table = data
            for part in header.group(1).split("."):
                table = table.setdefault(part.strip(), {})
            continue
        pair = re.match(r"([A-Za-z0-9_.\"-]+)\s*=\s*(.+)$", line)
        if not pair:
            continue
        key, value = pair.group(1).strip('"'), pair.group(2).strip()
        if value.startswith("{") and value.endswith("}"):
            inner = {}
            for item in re.finditer(r'([A-Za-z0-9_-]+)\s*=\s*"([^"]*)"', value):
                inner[item.group(1)] = item.group(2)
            table[key] = inner
        elif value.startswith('"') and value.endswith('"'):
            table[key] = value[1:-1]
        else:
            table[key] = value
    return data


def read_lock(project: str) -> dict:
    try:
        with open(os.path.join(project, "flow.lock"), encoding="utf-8") as handle:
            lock = json.load(handle)
        packages = lock.get("packages") if isinstance(lock, dict) else None
        return packages if isinstance(packages, dict) else {}
    except (OSError, ValueError):
        return {}


def describe(spec) -> tuple[str, str]:
    """(source, text) for a dependency spec as flow.toml writes it."""
    if isinstance(spec, dict):
        if "path" in spec:
            return "path", str(spec["path"])
        if "git" in spec:
            pin = spec.get("tag") or spec.get("rev") or spec.get("branch") or ""
            return "git", str(spec["git"]) + (" " + str(pin) if pin else "")
        if "version" in spec:
            return "registry", str(spec["version"])
        return "other", json.dumps(spec)[:200]
    return "registry", str(spec)


def installed(project: str, name: str) -> bool:
    base = os.path.join(project, "flow_packages")
    return os.path.isdir(os.path.join(base, name)) or os.path.isfile(os.path.join(base, name + ".flow"))


def dependencies(project: str, manifest: dict | None) -> list[dict]:
    if not manifest:
        return []
    lock = read_lock(project)
    rows = []
    for group in ("dependencies", "dev-dependencies"):
        table = manifest.get(group)
        if not isinstance(table, dict):
            continue
        for name, spec in table.items():
            source, text = describe(spec)
            locked = lock.get(name, {}) if isinstance(lock.get(name), dict) else {}
            version = locked.get("version")
            rows.append({
                "name": str(name),
                "spec": text,
                "source": locked.get("source") or source,
                "locked": version if isinstance(version, str) else "",
                "installed": installed(project, str(name)),
                "dev": group == "dev-dependencies",
            })
    return rows[:400]


def reply(project: str, ok: bool, output: str) -> dict:
    manifest = None
    error = ""
    try:
        manifest = read_manifest(project)
    except Refused as refused:
        error = str(refused)
    package = manifest.get("package", {}) if isinstance(manifest, dict) else {}
    return {
        "ok": ok and not error,
        "project": project,
        "manifest": manifest is not None or bool(error),
        "name": str(package.get("name", "")) if isinstance(package, dict) else "",
        "dependencies": dependencies(project, manifest),
        "output": clean((output + ("\n" + error if error else "")).strip()),
    }


def run_flow(project: str, args: list[str]) -> tuple[bool, str]:
    flow = shutil.which("flow")
    if not flow:
        return False, "The flow command was not found on PATH."
    env = dict(os.environ, NO_COLOR="1", TERM="dumb")
    try:
        done = subprocess.run([flow, *args], cwd=project, env=env, stdin=subprocess.DEVNULL,
                              capture_output=True, text=True, timeout=TIMEOUT, check=False)
    except subprocess.TimeoutExpired:
        return False, "flow " + " ".join(args) + f" stopped after {TIMEOUT} seconds."
    text = "$ flow " + " ".join(args) + "\n" + done.stdout + done.stderr
    # The package manager exits 0 after some failures; its red lines say so.
    failed = (done.returncode != 0 or re.search(r"\x1b\[(?:0;)?(?:91|31)m", done.stdout + done.stderr)
              or "already in dependencies" in done.stdout)
    return not failed, text


def path_name(project: str, target: str) -> str:
    """The name a path dependency is added under: its manifest's package
    name, or the folder name."""
    folder = os.path.normpath(os.path.join(project, os.path.expanduser(target)))
    if not os.path.isdir(folder):
        raise Refused("The dependency folder does not exist: " + target)
    name = ""
    try:
        manifest = read_manifest(folder)
        package = manifest.get("package", {}) if manifest else {}
        name = str(package.get("name", "")) if isinstance(package, dict) else ""
    except (OSError, Refused):
        name = ""
    name = name or os.path.basename(folder)
    if not NAME.match(name):
        raise Refused("The dependency folder has no usable package name: " + name)
    return name


def add_args(project: str, spec: str) -> list[str]:
    spec = spec.strip()
    if not spec:
        raise Refused("Type a package name, a git URL or a folder path.")
    if spec.startswith(("/", "./", "../", "~")):
        return ["add", "--path", spec, "--name", path_name(project, spec)]
    if GIT_URL.match(spec):
        return ["add", "--git", spec]
    if REGISTRY_SPEC.match(spec):
        return ["add", spec]
    raise Refused("Not a package name, git URL or folder path: " + spec[:80])


def drop_from_manifest(text: str, name: str) -> tuple[str, bool]:
    """flow.toml without NAME under [dependencies] or [dev-dependencies],
    or a [dependencies.NAME] table. Other lines stay as they are."""
    out: list[str] = []
    section = ""
    skipping = False
    removed = False
    key = re.compile(r'\s*"?' + re.escape(name) + r'"?\s*=')
    for line in text.split("\n"):
        header = re.match(r"\s*\[([^\]]+)\]\s*(?:#.*)?$", line)
        if header:
            section = header.group(1).strip()
            skipping = section in (f"dependencies.{name}", f"dev-dependencies.{name}")
            if skipping:
                removed = True
                continue
        if skipping:
            continue
        if section in ("dependencies", "dev-dependencies") and key.match(line):
            removed = True
            continue
        out.append(line)
    return "\n".join(out), removed


def remove(project: str, name: str) -> tuple[bool, str]:
    name = name.strip()
    if not NAME.match(name):
        raise Refused("Not a dependency name: " + name[:80])
    path = manifest_path(project)
    if not os.path.isfile(path):
        raise Refused("This folder has no flow.toml.")
    with open(path, encoding="utf-8") as handle:
        text = handle.read()
    updated, removed = drop_from_manifest(text, name)
    if not removed:
        raise Refused(name + " is not a dependency in flow.toml.")
    with open(path + ".tmp", "w", encoding="utf-8") as handle:
        handle.write(updated)
    os.replace(path + ".tmp", path)
    lines = [f"Removed {name} from flow.toml."]
    lock_path = os.path.join(project, "flow.lock")
    try:
        with open(lock_path, encoding="utf-8") as handle:
            lock = json.load(handle)
        if isinstance(lock, dict) and isinstance(lock.get("packages"), dict) and name in lock["packages"]:
            del lock["packages"][name]
            with open(lock_path + ".tmp", "w", encoding="utf-8") as handle:
                json.dump(lock, handle, indent=2)
                handle.write("\n")
            os.replace(lock_path + ".tmp", lock_path)
            lines.append(f"Removed {name} from flow.lock.")
    except (OSError, ValueError):
        pass
    packages = os.path.realpath(os.path.join(project, "flow_packages"))
    for candidate in (os.path.join(packages, name), os.path.join(packages, name + ".flow")):
        real = os.path.realpath(candidate)
        if os.path.dirname(real) != packages or os.path.islink(candidate):
            continue
        if os.path.isdir(real):
            shutil.rmtree(real)
            lines.append(f"Deleted flow_packages/{name}.")
        elif os.path.isfile(real):
            os.remove(real)
            lines.append(f"Deleted flow_packages/{name}.flow.")
    ok, synced = run_flow(project, ["sync"])
    return ok, "\n".join(lines) + "\n" + synced


def handle(operation: str, body: str) -> tuple[int, dict]:
    if operation not in OPERATIONS:
        return 2, {"ok": False, "output": "Unknown operation."}
    lines = body.split("\n")
    try:
        project = project_dir(lines[0] if lines else "")
        argument = lines[1] if len(lines) > 1 else ""
        if operation == "list":
            return 0, reply(project, True, "")
        if operation == "init":
            if os.path.exists(manifest_path(project)):
                raise Refused("This folder already has a flow.toml.")
            ok, output = run_flow(project, ["init"])
        elif operation == "add":
            if not os.path.isfile(manifest_path(project)):
                raise Refused("This folder has no flow.toml. Create one first.")
            ok, output = run_flow(project, add_args(project, argument))
        elif operation == "remove":
            ok, output = remove(project, argument)
        else:
            if not os.path.isfile(manifest_path(project)):
                raise Refused("This folder has no flow.toml. Create one first.")
            ok, output = run_flow(project, ["sync"])
        return 0, reply(project, ok, output)
    except Refused as refused:
        return 2, {"ok": False, "output": str(refused)}


def main() -> int:
    operation, _, body = sys.stdin.read(65536).partition("\n")
    status, data = handle(operation.strip(), body)
    sys.stdout.write(json.dumps(data))
    return status


if __name__ == "__main__":
    sys.exit(main())
