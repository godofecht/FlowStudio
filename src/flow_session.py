"""A persistent Flow session for the console.

Flow compiles whole programs, so a session is rebuilt for every entry:
earlier declarations stay at file scope, earlier variables come back as
`let` bindings with the values they had, and the new entry runs after them.
The native server drives three steps:

    prepare   reads an entry on stdin, prints the program to run (exit 0)
              or a JSON error reply (exit 2)
    commit    reads the program's output on stdin, records the new values
              and prints the JSON reply for the console
    state     prints the variables and declarations as JSON
    reset     forgets everything

The program runs between prepare and commit through the server's bridged
runner, so `import flowstudio { py, r }` works from the console.

Types come from the Flow checker itself. prepare compiles a probe in which
every new variable is assigned to a struct type it cannot match; the
checker's "initialized with T" message names T. Values come back from a
dump section appended to the program, framed so strings may hold any byte.
Values the session cannot rebuild as literals (pointers, lists, maps,
nested arrays, very large arrays, non-finite floats) are listed with their
type and marked as not kept.
"""
from __future__ import annotations

import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BRIDGE_MODULE = os.path.join(ROOT, "src", "flowstudio.flow")
PROBE_TYPE = "FlowStudioSessionProbe"
VALUE_NAME = "flowstudio_value"
SENTINEL = "\x1eFLOWSTUDIO-SESSION\x1e"
ARRAY_LIMIT = 4096
ENTRY_LIMIT = 256 * 1024

INTEGER_TYPES = {"i8", "i16", "i32", "i64", "u8", "u16", "u32", "u64", "isize", "usize"}
FLOAT_TYPES = {"f32", "f64"}
SCALAR_TYPES = INTEGER_TYPES | FLOAT_TYPES | {"bool", "string"}
DECLARATION = re.compile(r"(?:pub\s+)?(function|struct|enum|import|extern|type|const|trait|impl|field)\b")
LET = re.compile(r"let\s+(mut\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*(?::\s*([^=]+?))?\s*=")
STATEMENT_KEYWORDS = re.compile(r"(?:let|if|while|for|return|break|continue|match|loop|elif|else)\b")
PLAIN_REFERENCE = re.compile(r"[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$")
ARRAY_TYPE = re.compile(r"array<\s*([A-Za-z0-9_]+)\s*,\s*(\d+)\s*>$")
NAMED_DECLARATION = re.compile(r"(?:pub\s+)?(?:function|struct|enum|type|const|trait|field)\s+([A-Za-z_][A-Za-z0-9_]*)")


# ---- state ---------------------------------------------------------------

def state_dir() -> str:
    """A private directory per user and server port."""
    port = os.environ.get("FLOWSTUDIO_PORT", "8751")
    if not port.isdigit():
        port = "8751"
    base = os.path.join(tempfile.gettempdir(), f"flowstudio-flow-session-{os.getuid()}-{port}")
    os.makedirs(base, mode=0o700, exist_ok=True)
    info = os.lstat(base)
    if not os.path.isdir(base) or os.path.islink(base) or info.st_uid != os.getuid():
        raise SystemExit("FlowStudio: the Flow session directory is not private.")
    os.chmod(base, 0o700)
    return base


def empty_state() -> dict:
    return {"imports": [], "declarations": [], "variables": [], "pending": None, "entries": 0}


def load(directory: str) -> dict:
    try:
        with open(os.path.join(directory, "state.json"), encoding="utf-8") as handle:
            state = json.load(handle)
        if isinstance(state, dict) and isinstance(state.get("variables"), list):
            return state
    except (OSError, ValueError):
        pass
    return empty_state()


def save(directory: str, state: dict) -> None:
    path = os.path.join(directory, "state.json")
    temporary = path + ".tmp"
    with open(temporary, "w", encoding="utf-8") as handle:
        json.dump(state, handle)
    os.replace(temporary, path)


# ---- splitting an entry --------------------------------------------------

def strip_code(line: str) -> str:
    """The line with string contents and comments blanked, for brace counts."""
    out, quoted, escaped = [], False, False
    for char in line:
        if quoted:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                quoted = False
                out.append('"')
                continue
            out.append(" ")
            continue
        if char == "#":
            break
        if char == '"':
            quoted = True
        out.append(char)
    return "".join(out)


def split_items(source: str) -> list[dict]:
    """Top-level items: each is a declaration or a statement, with the
    zero-based line it starts on. Brackets keep multi-line items whole."""
    items: list[dict] = []
    current: list[str] = []
    start = 0
    depth = 0
    kind = ""
    for number, line in enumerate(source.split("\n")):
        code = strip_code(line)
        if depth == 0 and not current:
            if not code.strip():
                continue
            start = number
            kind = "declaration" if DECLARATION.match(line) and line == line.lstrip() else "statement"
        current.append(line)
        for char in code:
            if char in "{([":
                depth += 1
            elif char in "})]":
                depth = max(0, depth - 1)
        continues = code.rstrip().endswith(("=", "+", "-", "*", "/", ",", "(", "and", "or", "&&", "||"))
        if depth == 0 and not continues:
            # `} else {` and `elif` keep an if statement going.
            items.append({"kind": kind, "text": "\n".join(current), "line": start})
            current = []
        elif depth == 0 and continues:
            continue
    if current:
        items.append({"kind": kind, "text": "\n".join(current), "line": start})
    merged: list[dict] = []
    for item in items:
        head = item["text"].lstrip()
        if merged and item["kind"] == "statement" and re.match(r"(?:else|elif)\b", head):
            merged[-1]["text"] += "\n" + item["text"]
        else:
            merged.append(item)
    return merged


def declaration_name(text: str) -> str:
    match = NAMED_DECLARATION.match(text.lstrip())
    return match.group(1) if match else ""


def is_expression(text: str) -> bool:
    """A bare expression whose value the console should show."""
    head = text.strip()
    if not head or STATEMENT_KEYWORDS.match(head):
        return False
    if re.match(r"(?:println|print|printf)\s*\(", head):
        return False
    # An assignment such as `x = 1` or `xs[i] += 2`.
    if re.match(r"[A-Za-z_][A-Za-z0-9_.\[\]\s]*(?:[-+*/%]?=)(?!=)", head):
        return False
    return True


# ---- literals and dumps --------------------------------------------------

def flow_string(text: str) -> str:
    out = ['"']
    for char in text:
        code = ord(char)
        if char == '"':
            out.append('\\"')
        elif char == "\\":
            out.append("\\\\")
        elif char == "\n":
            out.append("\\n")
        elif char == "\t":
            out.append("\\t")
        elif char == "\r":
            out.append("\\r")
        elif code < 32 or code == 127:
            out.append("\\x%02x" % code)
        else:
            out.append(char)
    out.append('"')
    return "".join(out)


def float_literal(value: float) -> str | None:
    if not math.isfinite(value):
        return None
    text = repr(float(value))
    if "e" in text or "E" in text:
        mantissa, exponent = text.lower().split("e")
        if "." not in mantissa:
            mantissa += ".0"
        return mantissa + "e" + exponent
    return text if "." in text else text + ".0"


def scalar_literal(kind: str, value) -> str | None:
    if kind in INTEGER_TYPES:
        return str(int(value))
    if kind in FLOAT_TYPES:
        return float_literal(float(value))
    if kind == "bool":
        return "true" if value else "false"
    if kind == "string":
        return flow_string(value)
    return None


def struct_fields(state: dict, extra: list[str], name: str) -> list[tuple[str, str]] | None:
    """Field names and types of a session struct whose fields are scalars."""
    for text in list(state["declarations"]) + extra:
        match = re.match(r"\s*(?:pub\s+)?struct\s+" + re.escape(name) + r"\s*\{(.*)\}\s*$", text, re.S)
        if not match:
            continue
        fields = []
        for part in re.split(r"[\n,]", match.group(1)):
            part = strip_code(part).strip()
            if not part:
                continue
            field = re.match(r"([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-z0-9_]+)$", part)
            if not field or field.group(2) not in SCALAR_TYPES:
                return None
            fields.append((field.group(1), field.group(2)))
        return fields or None
    return None


def keepable(state: dict, extra: list[str], kind: str) -> bool:
    if kind in SCALAR_TYPES:
        return True
    array = ARRAY_TYPE.match(kind)
    if array:
        return array.group(1) in SCALAR_TYPES and int(array.group(2)) <= ARRAY_LIMIT
    return struct_fields(state, extra, kind) is not None


def dump_scalar(kind: str, expression: str) -> str:
    if kind in FLOAT_TYPES:
        return f'    printf("%.17g\\n", {expression})'
    if kind == "string":
        return f'    printf("%d:%s\\n", len({expression}), {expression})'
    return f"    println({expression})"


def dump_lines(state: dict, extra: list[str], name: str, kind: str, expression: str = "") -> list[str]:
    lines = [f'    println("{SENTINEL}{name}")']
    target = expression or name
    array = ARRAY_TYPE.match(kind)
    if kind in SCALAR_TYPES:
        lines.append(dump_scalar(kind, target))
    elif array:
        counter = f"flowstudio_i_{name}"
        lines += [f"    let mut {counter}: i32 = 0",
                  f"    while {counter} < {array.group(2)} {{",
                  "    " + dump_scalar(array.group(1), f"({target})[{counter}]"),
                  f"        {counter} = {counter} + 1",
                  "    }"]
    else:
        for field, field_kind in struct_fields(state, extra, kind) or []:
            lines.append(dump_scalar(field_kind, f"({target}).{field}"))
    return lines


class Reader:
    """Reads dumped values back from the program's stdout."""

    def __init__(self, text: str):
        self.data = text.encode("utf-8", "surrogateescape")
        self.at = 0

    def line(self) -> str:
        end = self.data.find(b"\n", self.at)
        if end < 0:
            raise ValueError("truncated dump")
        text = self.data[self.at:end].decode("utf-8", "replace")
        self.at = end + 1
        return text

    def scalar(self, kind: str):
        if kind == "string":
            head_end = self.data.find(b":", self.at)
            length = int(self.data[self.at:head_end])
            value = self.data[head_end + 1:head_end + 1 + length].decode("utf-8", "replace")
            self.at = head_end + 1 + length
            if self.data[self.at:self.at + 1] == b"\n":
                self.at += 1
            return value
        text = self.line().strip()
        if kind in FLOAT_TYPES:
            return float(text)
        if kind == "bool":
            return text not in ("0", "false")
        return int(text)


def read_value(state: dict, extra: list[str], reader: Reader, kind: str):
    array = ARRAY_TYPE.match(kind)
    if kind in SCALAR_TYPES:
        return reader.scalar(kind)
    if array:
        return [reader.scalar(array.group(1)) for _ in range(int(array.group(2)))]
    return {field: reader.scalar(field_kind)
            for field, field_kind in struct_fields(state, extra, kind) or []}


def literal(state: dict, extra: list[str], kind: str, value) -> str | None:
    array = ARRAY_TYPE.match(kind)
    if kind in SCALAR_TYPES:
        return scalar_literal(kind, value)
    if array:
        parts = [scalar_literal(array.group(1), item) for item in value]
        return None if None in parts else "[" + ", ".join(parts) + "]"
    fields = struct_fields(state, extra, kind) or []
    parts = [scalar_literal(field_kind, value.get(field)) for field, field_kind in fields]
    if None in parts:
        return None
    return kind + " { " + ", ".join(f"{field}: {part}" for (field, _), part in zip(fields, parts)) + " }"


def display_scalar(kind: str, value) -> str:
    if kind in FLOAT_TYPES:
        if not math.isfinite(value):
            return str(value)
        text = repr(float(value)) if kind == "f64" else ("%.9g" % value)
        return text if any(c in text for c in ".eEn") else text + ".0"
    if kind == "bool":
        return "true" if value else "false"
    if kind == "string":
        return flow_string(value)
    return str(value)


def display(state: dict, extra: list[str], kind: str, value, limit: int = 0) -> str:
    array = ARRAY_TYPE.match(kind)
    if kind in SCALAR_TYPES:
        return display_scalar(kind, value)
    if array:
        items = [display_scalar(array.group(1), item) for item in value]
        if limit and len(items) > limit:
            items = items[:limit] + [f"... {len(value) - limit} more"]
        return "[" + ", ".join(items) + "]"
    fields = struct_fields(state, extra, kind) or []
    return kind + " { " + ", ".join(
        f"{field}: {display_scalar(field_kind, value.get(field))}" for field, field_kind in fields) + " }"


# ---- programs ------------------------------------------------------------

def restore_lines(state: dict, shadowed: set[str]) -> list[str]:
    lines = []
    for variable in state["variables"]:
        if variable["name"] in shadowed or not variable.get("kept"):
            continue
        mutable = "mut " if variable.get("mutable") else ""
        lines.append(f"    let {mutable}{variable['name']}: {variable['type']} = {variable['literal']}")
    return lines


def program(imports: list[str], declarations: list[str], body: list[str], extra_top: list[str] = ()) -> tuple[str, int]:
    """The full program, and the line where the main body starts."""
    head = "\n".join(list(imports) + [""] + list(declarations) + list(extra_top) + ["function main() -> i32 {"])
    text = head + "\n" + "\n".join(body + ["    return 0", "}", ""])
    return text, head.count("\n") + 1


def declaration_lines(imports: list[str], declarations: list[str], new_items: list[tuple[str, int]]):
    """(program line, entry line, line count) for each declaration of this entry."""
    line = len(imports) + 1
    found = []
    for text in declarations:
        for item_text, item_line in new_items:
            if item_text is text:
                found.append((line, item_line, text.count("\n") + 1))
        line += text.count("\n") + 1
    return found


def annotate(text: str, types: dict[str, str]) -> str:
    """The statement with a type added to a top-level `let` that has none."""
    stripped = text.lstrip()
    match = LET.match(stripped)
    if not match or match.group(3) or match.group(2) not in types or types[match.group(2)] == "void":
        return text
    lead = text[:len(text) - len(stripped)]
    head = stripped[:match.end() - 1].rstrip()
    return lead + head + ": " + types[match.group(2)] + " =" + stripped[match.end():]


def run_checker(directory: str, source: str) -> str:
    work = tempfile.mkdtemp(prefix="probe-", dir=directory)
    try:
        path = os.path.join(work, "prog.flow")
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(source)
        if os.path.exists(BRIDGE_MODULE):
            shutil.copyfile(BRIDGE_MODULE, os.path.join(work, "flowstudio.flow"))
        completed = subprocess.run(
            ["flow", "tool", "compiler/scripts/flowc_emit.flow", "--strict", path, os.path.join(work, "out.c")],
            capture_output=True, text=True, timeout=60, check=False)
        return (completed.stdout + completed.stderr).replace(path, "entry")
    except FileNotFoundError:
        return "flow was not found"
    finally:
        shutil.rmtree(work, ignore_errors=True)


def indent(text: str) -> list[str]:
    return ["    " + line if line.strip() else line for line in text.split("\n")]


def error_reply(message: str, entries: int) -> str:
    return json.dumps({"ok": False, "output": message, "variables": None, "entry": entries})


def prepare(directory: str, entry: str) -> tuple[int, str]:
    state = load(directory)
    if len(entry.encode("utf-8")) > ENTRY_LIMIT:
        return 2, error_reply("This entry is larger than 256 KiB.", state["entries"])
    if re.search(r"(^|\n)\s*(?:pub\s+)?function\s+main\s*\(", entry):
        # A whole program runs as it is, outside the session.
        state["pending"] = {"whole": True}
        save(directory, state)
        return 0, entry
    items = split_items(entry)
    imports = list(state["imports"])
    declarations = list(state["declarations"])
    new_declarations: list[str] = []
    new_items: list[tuple[str, int]] = []
    statements: list[dict] = []
    for item in items:
        if item["kind"] == "declaration":
            text = item["text"].strip("\n")
            if text.lstrip().startswith("import"):
                for line in text.split("\n"):
                    if line.strip() and line.strip() not in imports:
                        imports.append(line.strip())
                continue
            name = declaration_name(text)
            if name:
                declarations = [d for d in declarations if declaration_name(d) != name]
            declarations.append(text)
            new_declarations.append(text)
            new_items.append((text, item["line"]))
        else:
            statements.append(item)
    show_last = bool(statements) and is_expression(statements[-1]["text"])
    names: list[tuple[str, bool, str | None]] = []
    for item in statements:
        match = LET.match(item["text"].strip())
        if match:
            names = [n for n in names if n[0] != match.group(2)]
            names.append((match.group(2), bool(match.group(1)), match.group(3)))
    shadowed = {name for name, _, _ in names}
    restore = restore_lines(state, shadowed)

    body_lines: list[str] = []
    line_map: list[int] = []  # program body line -> entry line
    for item in statements[:-1] if show_last else statements:
        for offset, line in enumerate(indent(item["text"])):
            body_lines.append(line)
            line_map.append(item["line"] + offset)
    last_lines: list[str] = []
    reference = ""
    if show_last:
        last = statements[-1]
        if PLAIN_REFERENCE.match(last["text"].strip()):
            # A variable or field is shown in place; C cannot copy arrays.
            reference = last["text"].strip()
        else:
            last_lines = indent(f"let {VALUE_NAME} = " + last["text"].strip())

    # Probe: the checker names the type of each new variable and of the value.
    probe_names = [name for name, _, _ in names] + ([VALUE_NAME] if show_last else [])
    probe_values = [name for name, _, _ in names] + ([reference or VALUE_NAME] if show_last else [])
    probe_body = restore + body_lines + last_lines + [
        f"    let flowstudio_probe_{index}: {PROBE_TYPE} = {value}" for index, value in enumerate(probe_values)]
    probe_top = [f"struct {PROBE_TYPE} {{", "    flowstudio_unused: i32", "}", ""]
    probe_source, probe_start = program(imports, declarations, probe_body, probe_top)
    report = run_checker(directory, probe_source)
    if "flow was not found" in report:
        return 2, error_reply("The flow compiler was not found on PATH.", state["entries"])

    types: dict[str, str] = {}
    errors: list[str] = []
    probe_first = probe_start + len(restore) + len(body_lines) + len(last_lines)
    value_line = probe_start + len(restore) + len(body_lines)
    for line in report.splitlines():
        match = re.match(r"entry:(\d+):(\d+):\s*(?:error|warning):\s*(.*)$", line)
        if not match:
            continue
        number = int(match.group(1)) - 1
        message = match.group(3)
        probe = re.match(r"Variable 'flowstudio_probe_(\d+)' initialized with (.+) but annotated as " + PROBE_TYPE, message)
        if probe and number >= probe_first:
            types[probe_names[int(probe.group(1))]] = probe.group(2).strip()
            continue
        if number >= probe_first:
            # The probe of a shown value fails when the value itself is wrong.
            if show_last and number == probe_first + len(probe_names) - 1 and "Undefined" in message:
                errors.append(f"line {statements[-1]['line'] + 1}: " + message)
            continue
        entry_line = None
        if probe_start + len(restore) <= number < value_line:
            entry_line = line_map[number - probe_start - len(restore)] + 1
        elif value_line <= number < probe_first and show_last:
            entry_line = statements[-1]["line"] + (number - value_line) + 1
        elif number < probe_start:
            # A declaration from this entry maps back to its line.
            for program_line, item_line, count in declaration_lines(imports, declarations, new_items):
                if program_line <= number < program_line + count:
                    entry_line = item_line + number - program_line + 1
        location = f"line {entry_line}: " if entry_line else ""
        errors.append(location + message.replace(VALUE_NAME, "value"))
    if errors or ("typecheck failed" in report and not types) or "parse" in report and "error" in report and not types:
        if not errors:
            errors = [line for line in report.splitlines() if "error" in line][:12] or [report.strip()[-2000:]]
        return 2, error_reply("\n".join(errors), state["entries"])

    # The program to run: earlier state, the entry, then a framed dump.
    # Every inferred `let` gets the type the checker found. flowc can emit a
    # different C type for an unannotated binding (a float product declared
    # int32_t), so the run never relies on that inference.
    run_body = list(restore)
    for item in statements[:-1] if show_last else statements:
        run_body += indent(annotate(item["text"], types))
    value_kind = types.get(VALUE_NAME) if show_last else None
    if show_last and not reference:
        if value_kind == "void" or value_kind is None:
            run_body += indent(statements[-1]["text"].strip())
        else:
            run_body += indent(f"let {VALUE_NAME}: {value_kind} = " + statements[-1]["text"].strip())
    dump: list[str] = []
    recorded: list[dict] = []
    kept_names = [v for v in state["variables"] if v["name"] not in shadowed]
    for variable in kept_names:
        if variable.get("kept"):
            dump += dump_lines(state, new_declarations, variable["name"], variable["type"])
            recorded.append({"name": variable["name"], "type": variable["type"],
                             "mutable": variable.get("mutable", False)})
    for name, mutable, _ in names:
        kind = types.get(name, "")
        record = {"name": name, "type": kind, "mutable": mutable}
        if kind and keepable(state, new_declarations, kind):
            dump += dump_lines(state, new_declarations, name, kind)
        else:
            record["kept"] = False
        recorded.append(record)
    if value_kind and value_kind != "void":
        if keepable(state, new_declarations, value_kind):
            dump += dump_lines(state, new_declarations, VALUE_NAME, value_kind, reference)
        recorded.append({"name": VALUE_NAME, "type": value_kind, "mutable": False, "value": True})
    source, _ = program(imports, declarations, run_body + dump)
    state["pending"] = {"imports": imports, "declarations": declarations,
                        "new_declarations": new_declarations, "recorded": recorded}
    save(directory, state)
    return 0, source


def commit(directory: str, status: int, output: str) -> str:
    state = load(directory)
    pending = state.get("pending") or {}
    state["pending"] = None
    if pending.get("whole") or not pending:
        save(directory, state)
        return json.dumps({"ok": status == 200, "output": output, "variables": variables_view(state),
                           "entry": state["entries"]})
    if output.strip() == "(No output)":
        output = ""
    marker = output.find(SENTINEL)
    printed = output if marker < 0 else output[:marker]
    expects_dump = any(record.get("kept") is not False for record in pending["recorded"])
    if status == 200 and marker < 0 and not expects_dump:
        marker = len(output)
    if status != 200 or marker < 0:
        save(directory, state)
        return json.dumps({"ok": False, "output": output.replace(SENTINEL, ""), "variables": variables_view(state),
                           "entry": state["entries"]})
    extra = pending["new_declarations"]
    reader = Reader(output[marker:])
    values: dict[str, object] = {}
    try:
        for record in pending["recorded"]:
            if record.get("kept") is False or not keepable(state, extra, record["type"]):
                continue
            header = reader.line()
            if header != SENTINEL + record["name"]:
                raise ValueError("dump out of order at " + record["name"])
            values[record["name"]] = read_value(state, extra, reader, record["type"])
    except (ValueError, IndexError) as error:
        save(directory, state)
        return json.dumps({"ok": False, "output": printed + f"FlowStudio could not read the session values ({error}).",
                           "variables": variables_view(state), "entry": state["entries"]})
    tail = reader.data[reader.at:].decode("utf-8", "replace")

    state["imports"] = pending["imports"]
    state["declarations"] = pending["declarations"]
    shown = None
    variables: list[dict] = []
    for record in pending["recorded"]:
        if record.get("value"):
            if record["name"] in values:
                shown = display(state, extra, record["type"], values[record["name"]], 100)
            continue
        variable = {"name": record["name"], "type": record["type"], "mutable": record["mutable"], "kept": False}
        if record["name"] in values:
            value = values[record["name"]]
            text = literal(state, extra, record["type"], value)
            if text is not None:
                variable.update(kept=True, literal=text)
            variable["display"] = display(state, extra, record["type"], value, 12)
            variable["size"] = len(value) if isinstance(value, list) else None
        variables.append(variable)
    state["variables"] = variables
    state["entries"] += 1
    save(directory, state)
    text = printed + tail
    if shown is not None:
        text += shown + "\n"
    return json.dumps({"ok": True, "output": text, "variables": variables_view(state), "entry": state["entries"]})


def variables_view(state: dict) -> list[dict]:
    return [{key: variable.get(key) for key in ("name", "type", "mutable", "kept", "display", "size")}
            for variable in state["variables"]]


def state_reply(directory: str) -> str:
    state = load(directory)
    return json.dumps({"variables": variables_view(state),
                       "declarations": [declaration_name(d) or d.split("\n")[0] for d in state["declarations"]],
                       "imports": state["imports"], "entry": state["entries"]})


def main(argv: list[str]) -> int:
    if len(argv) < 2 or argv[1] not in ("prepare", "commit", "state", "reset"):
        print("usage: flow_session.py prepare|commit STATUS|state|reset", file=sys.stderr)
        return 64
    directory = state_dir()
    if argv[1] == "prepare":
        code, text = prepare(directory, sys.stdin.read())
        sys.stdout.write(text)
        return code
    if argv[1] == "commit":
        status = int(argv[2]) if len(argv) > 2 and argv[2].isdigit() else 0
        reply = commit(directory, status, sys.stdin.read())
        sys.stdout.write(reply)
        # 3 tells the server the entry failed.
        return 0 if json.loads(reply)["ok"] else 3
    if argv[1] == "reset":
        save(directory, empty_state())
        sys.stdout.write(json.dumps({"ok": True, "variables": []}))
        return 0
    sys.stdout.write(state_reply(directory))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
