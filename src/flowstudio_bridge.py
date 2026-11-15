"""flowstudio: call R and Flow from the persistent Python session.

    import flowstudio as fs
    fs.R.scores = [72, 88, 95]          # becomes an R numeric vector
    fs.r("summary(lm(mpg ~ wt, mtcars))$r.squared")
    frame = fs.R.mtcars                 # an R data.frame comes back as a Frame
    fs.flow("kernel.flow")              # compile and run Flow, returns stdout

The R calls run in FlowStudio's persistent R session, so the variables they
create are visible in the R console and the Data view. Values cross as JSON
from R and as R source to R. A data frame crosses as a Frame; Frame.to_pandas()
converts it when pandas is installed.

Inside the kernel the module is registered as ``flowstudio``. The transport is
the kernel protocol: a request is "Q" + 8 hex digits + target + format +
source on fd 3, and the reply arrives on stdin as "0"/"1" + 8 hex digits +
text. The C session relays it to the other language.
"""
from __future__ import annotations

import ast
import contextlib
import io
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
import traceback
import urllib.parse

__all__ = ["r", "R", "flow", "Frame", "Rows", "RError", "FlowError", "to_r"]

_channel: tuple | None = None
_namespace: dict | None = None
_LIBRARY = os.path.join(os.path.dirname(os.path.abspath(__file__)), "flowstudio.flow")


class RError(RuntimeError):
    """R raised an error while evaluating a bridge call."""


class FlowError(RuntimeError):
    """A Flow program failed to compile or exited unsuccessfully."""


def connect(protocol, stdin, namespace) -> None:
    global _channel, _namespace
    _channel = (protocol, stdin)
    _namespace = namespace


def _read_exact(stream, count: int) -> bytes:
    data = bytearray()
    while len(data) < count:
        part = stream.read(count - len(data))
        if not part:
            raise ConnectionError("FlowStudio bridge closed")
        data.extend(part)
    return bytes(data)


def _call(target: str, fmt: str, source: str) -> tuple[bool, str]:
    if _channel is None:
        raise RuntimeError("The flowstudio bridge works inside FlowStudio's Python session.")
    protocol, stdin = _channel
    body = (target + fmt + source).encode("utf-8")
    protocol.write(b"Q" + f"{len(body):08x}".encode("ascii") + body)
    header = _read_exact(stdin, 9)
    length = int(header[1:], 16)
    text = _read_exact(stdin, length).decode("utf-8", "replace")
    return header[:1] == b"0", text


# ---- Frame: a small column store that prints as a table ------------------

class Frame(dict):
    """Columns by name, all the same length. R data.frames arrive as Frames."""

    @property
    def columns(self) -> list[str]:
        return list(self.keys())

    @property
    def nrow(self) -> int:
        return len(next(iter(self.values()))) if self else 0

    def rows(self) -> list[dict]:
        return [{name: self[name][i] for name in self} for i in range(self.nrow)]

    @classmethod
    def from_rows(cls, rows: list[dict]) -> "Frame":
        names: list[str] = []
        for row in rows:
            for name in row:
                if name not in names:
                    names.append(name)
        return cls({name: [row.get(name) for row in rows] for name in names})

    def to_pandas(self):
        import pandas
        return pandas.DataFrame(dict(self))

    def __repr__(self) -> str:
        if not self:
            return "Frame()"
        names = self.columns
        shown = min(self.nrow, 10)
        cells = [[str(name) for name in names]]
        for i in range(shown):
            cells.append([_cell(self[name][i]) for name in names])
        widths = [max(len(row[c]) for row in cells) for c in range(len(names))]
        lines = ["  ".join(value.rjust(widths[c]) for c, value in enumerate(row)) for row in cells]
        if self.nrow > shown:
            lines.append(f"... {self.nrow - shown} more rows")
        lines.append(f"[{self.nrow} rows x {len(names)} columns]")
        return "\n".join(lines)


def _cell(value) -> str:
    if value is None:
        return "NA"
    if isinstance(value, float):
        return f"{value:.6g}"
    return str(value)


# ---- Python -> R source --------------------------------------------------

def _r_string(text: str) -> str:
    out = ['"']
    for ch in text:
        code = ord(ch)
        if ch == '"':
            out.append('\\"')
        elif ch == "\\":
            out.append("\\\\")
        elif ch == "\n":
            out.append("\\n")
        elif ch == "\t":
            out.append("\\t")
        elif ch == "\r":
            out.append("\\r")
        elif code < 32 or code == 127:
            out.append(f"\\x{code:02x}")
        else:
            out.append(ch)
    out.append('"')
    return "".join(out)


def _r_name(name) -> str:
    return "`" + str(name).replace("\\", "\\\\").replace("`", "\\`") + "`"


def _r_scalar(value) -> str | None:
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, int):
        return f"{value}L" if -2147483647 <= value <= 2147483647 else repr(float(value))
    if isinstance(value, float):
        if math.isnan(value):
            return "NaN"
        if math.isinf(value):
            return "Inf" if value > 0 else "-Inf"
        return repr(value)
    if isinstance(value, str):
        return _r_string(value)
    try:  # numpy scalars
        import numpy
        if isinstance(value, numpy.generic):
            return _r_scalar(value.item())
    except ImportError:
        pass
    return None


def _vector(values: list) -> str | None:
    """An atomic R vector when every item is a scalar of one kind (None is NA)."""
    kinds = set()
    for value in values:
        if value is None:
            continue
        if isinstance(value, bool):
            kinds.add("lgl")
        elif isinstance(value, int):
            kinds.add("int" if -2147483647 <= value <= 2147483647 else "dbl")
        elif isinstance(value, float):
            kinds.add("dbl")
        elif isinstance(value, str):
            kinds.add("chr")
        else:
            try:
                import numpy
                if isinstance(value, numpy.generic):
                    return _vector([v.item() if isinstance(v, numpy.generic) else v for v in values])
            except ImportError:
                pass
            return None
    if kinds == {"int", "dbl"}:
        values = [float(v) if v is not None else None for v in values]
        kinds = {"dbl"}
    if len(kinds) > 1:
        return None
    kind = next(iter(kinds), "lgl")
    na = {"lgl": "NA", "int": "NA_integer_", "dbl": "NA_real_", "chr": "NA_character_"}[kind]
    if not values:
        return {"lgl": "logical(0)", "int": "integer(0)", "dbl": "numeric(0)", "chr": "character(0)"}[kind]
    return "c(" + ", ".join(na if v is None else _r_scalar(v) for v in values) + ")"


def _is_records(value) -> bool:
    return (isinstance(value, list) and value and all(isinstance(row, dict) for row in value))


def to_r(value) -> str:
    """R source that rebuilds value in R."""
    if value is None:
        return "NULL"
    scalar = _r_scalar(value)
    if scalar is not None:
        return scalar
    module = type(value).__module__ or ""
    if module.startswith("pandas.") and type(value).__name__ == "DataFrame":
        value = Frame({str(name): value[name].tolist() for name in value.columns})
    elif module.startswith("pandas.") and type(value).__name__ == "Series":
        value = value.tolist()
    elif module.startswith("numpy") and type(value).__name__ == "ndarray":
        if value.ndim == 2:
            flat = to_r(value.reshape(-1).tolist())
            return f"matrix({flat}, nrow = {value.shape[0]}L, byrow = TRUE)"
        value = value.tolist()
    if _is_records(value):
        value = Frame.from_rows(value)
    if isinstance(value, Frame):
        columns = ", ".join(f"{_r_name(name)} = {to_r(list(column))}" for name, column in value.items())
        return f"data.frame({columns}, check.names = FALSE, stringsAsFactors = FALSE)"
    if isinstance(value, dict):
        items = ", ".join(f"{_r_name(key)} = {to_r(item)}" for key, item in value.items())
        return f"list({items})"
    if isinstance(value, (list, tuple, range, set, frozenset)):
        items = list(value)
        vector = _vector(items)
        if vector is not None:
            return vector
        return "list(" + ", ".join(to_r(item) for item in items) + ")"
    return _r_string(str(value))


# ---- R JSON -> Python ----------------------------------------------------

def _from_json(value):
    if isinstance(value, dict):
        if value.get("__frame__"):
            # Always a Frame; call .to_pandas() when pandas is installed.
            return Frame({name: [_from_json(v) for v in column]
                          for name, column in zip(value["names"], value["columns"])})
        if "__matrix__" in value:
            return [[_from_json(v) for v in row] for row in value["__matrix__"]]
        if "__repr__" in value:
            return value["__repr__"]
        return {key: _from_json(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_from_json(item) for item in value]
    return value


def r(source: str):
    """Evaluate R source in the R session and return its last value."""
    ok, text = _call("r", "j", source)
    if not ok:
        raise RError(text.strip())
    reply = json.loads(text)
    if reply.get("output"):
        sys.stdout.write(reply["output"])
    return _from_json(reply.get("value"))


class _RProxy:
    """R.name reads an R variable, R.name = value assigns one."""

    def __getattr__(self, name: str):
        if name.startswith("__"):
            raise AttributeError(name)
        return r(_r_name(name))

    def __setattr__(self, name: str, value) -> None:
        ok, text = _call("r", "j", f"{_r_name(name)} <- {to_r(value)}\ninvisible(NULL)")
        if not ok:
            raise RError(text.strip())

    __getitem__ = __getattr__
    __setitem__ = __setattr__

    def __call__(self, source: str):
        return r(source)

    def __repr__(self) -> str:
        return "<FlowStudio R session>"


R = _RProxy()


# ---- Evaluating requests from other languages ----------------------------

def _to_text(value) -> str:
    """The plain text form Flow programs read."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, float):
        return repr(value)
    if isinstance(value, (int, str)):
        return str(value)
    module = type(value).__module__ or ""
    if module.startswith("pandas.") and type(value).__name__ == "DataFrame":
        value = Frame({str(name): value[name].tolist() for name in value.columns})
    elif module.startswith("numpy") and hasattr(value, "tolist"):
        value = value.tolist()
    if _is_records(value):
        value = Frame.from_rows(value)
    if isinstance(value, Frame):
        lines = [",".join(_csv(name) for name in value.columns)]
        for row in value.rows():
            lines.append(",".join(_csv(row[name]) for name in value.columns))
        return "\n".join(lines)
    if isinstance(value, dict):
        return "\n".join(f"{key}={_to_text(item)}" for key, item in value.items())
    if isinstance(value, (list, tuple, set, frozenset, range)):
        return "\n".join(_to_text(item) for item in value)
    return str(value)


def _csv(value) -> str:
    text = _to_text(value) if value is not None else "NA"
    if any(ch in text for ch in ",\"\n"):
        return '"' + text.replace('"', '""') + '"'
    return text


def evaluate(namespace: dict, fmt: str, source: str) -> tuple[bool, bytes]:
    """Run source in the session namespace for another language.

    Statements run in order; when the last one is an expression its value is
    returned, formatted for the caller: R source with the captured output for
    R, plain text for Flow. Format "b" is a typed block from a Flow program
    (see block()).
    """
    if fmt == "b":
        return block(namespace, source)
    output = io.StringIO()
    value = None
    try:
        with contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
            tree = ast.parse(source, "<bridge>", "exec")
            last = tree.body.pop() if tree.body and isinstance(tree.body[-1], ast.Expr) else None
            exec(compile(tree, "<bridge>", "exec"), namespace)
            if last is not None:
                value = eval(compile(ast.Expression(last.value), "<bridge>", "eval"), namespace)
    except BaseException:
        kind, error, trace = sys.exc_info()
        frames = [frame for frame in traceback.extract_tb(trace) if frame.filename == "<bridge>"]
        text = output.getvalue() + "".join(traceback.format_list(frames)) + \
            "".join(traceback.format_exception_only(kind, error))
        return False, text.encode("utf-8", "replace")
    if fmt == "r":
        reply = f"list(value = {to_r(value)}, output = {_r_string(output.getvalue())})"
    else:
        printed = output.getvalue()
        reply = printed + _to_text(value) if fmt == "t" else json.dumps(
            {"value": repr(value), "output": printed})
    return True, reply.encode("utf-8", "replace")


# ---- Typed blocks from Flow ------------------------------------------------
#
# A Flow program sends a python(...) { ... } block as format "b" (see the
# request layout in src/flowstudio.flow). The values it passes are set in the
# session namespace under their Flow names while the block runs, the code
# runs with its Flow line numbers, and the last expression's value comes
# back as the Flow type the block asked for, or as an error that names the
# Flow line.

_BLOCK_FILE = "<flow>"
_BLOCK_REPLY_MAX = 120 * 1024
_BLOCK_OUTPUT_MAX = 32 * 1024
_BLOCK_ARRAY = re.compile(r"(f64|f32|i64|i32|bool|string)\[([0-9]+)\]$")


class _BlockFailure(Exception):
    pass


class _Lines:
    def __init__(self, text: str):
        self.text = text
        self.at = 0

    def next(self) -> str:
        end = self.text.find("\n", self.at)
        if end < 0:
            raise ValueError("the request ends early")
        line = self.text[self.at:end]
        self.at = end + 1
        return line

    def rest(self) -> str:
        return self.text[self.at:]


def _block_scalar(tag: str, text: str):
    if tag == "f":
        return float(text)
    if tag == "i":
        return int(text)
    if tag == "b":
        return text == "1"
    if tag == "s":
        return urllib.parse.unquote(text, errors="replace")
    raise ValueError(f"unknown value kind {tag!r}")


def _optional(module: str):
    try:
        return __import__(module)
    except ImportError:
        return None


def _block_values(lines: _Lines) -> tuple[dict, str]:
    """The values a block passes, by name, and the block's code."""
    values: dict = {}
    while True:
        tag = lines.next()
        if tag == "code":
            return values, lines.rest()
        name = lines.next()
        if tag in ("f", "i", "b", "s"):
            values[name] = _block_scalar(tag, lines.next())
        elif tag in ("F", "I", "B", "S"):
            count = int(lines.next())
            items = [_block_scalar(tag.lower(), lines.next()) for _ in range(count)]
            numpy = _optional("numpy") if tag != "S" else None
            # Arrays of numbers arrive as numpy arrays when numpy is installed.
            values[name] = numpy.array(items, dtype={"F": numpy.float64, "I": numpy.int64,
                                                      "B": numpy.bool_}[tag]) if numpy else items
        elif tag == "d":
            specs = [(lines.next(), lines.next()) for _ in range(int(lines.next()))]
            values[name] = {field: _block_scalar(kind, lines.next()) for kind, field in specs}
        elif tag == "R":
            rows = int(lines.next())
            specs = [(lines.next(), lines.next()) for _ in range(int(lines.next()))]
            records = Rows({field: _block_scalar(kind, lines.next()) for kind, field in specs}
                           for _ in range(rows))
            pandas = _optional("pandas")
            # Rows of structs arrive as a pandas DataFrame, or as Rows
            # (a list of dicts that also gives columns) without pandas.
            values[name] = pandas.DataFrame({field: records[field] for _, field in specs}) if pandas else records
        else:
            raise ValueError(f"unknown value kind {tag!r}")


class Rows(list):
    """Rows of a Flow struct array when pandas is not installed: a list of
    dicts, one per row, where rows["field"] is also the column."""

    def __getitem__(self, key):
        if isinstance(key, str):
            return [row[key] for row in self]
        return list.__getitem__(self, key)

    @property
    def columns(self) -> list[str]:
        return list(self[0].keys()) if self else []

    def to_pandas(self):
        import pandas
        return pandas.DataFrame(list(self))


def _describe(value) -> str:
    if value is None:
        return "None"
    text = repr(value)
    if len(text) > 60:
        text = text[:57] + "..."
    return f"{type(value).__name__} {text}"


def _block_scalar_out(kind: str, value) -> str:
    import numbers
    numpy = sys.modules.get("numpy")
    if kind in ("f64", "f32"):
        if isinstance(value, bool) or not isinstance(value, numbers.Real):
            raise ValueError("a number")
        return "%.17g" % float(value)
    if kind in ("i64", "i32"):
        if isinstance(value, bool) or (numpy is not None and isinstance(value, numpy.bool_)):
            raise ValueError("a whole number")
        if isinstance(value, numbers.Integral):
            number = int(value)
        elif isinstance(value, numbers.Real) and float(value).is_integer():
            number = int(float(value))
        else:
            raise ValueError("a whole number")
        bits = 31 if kind == "i32" else 63
        if not -(1 << bits) <= number < (1 << bits):
            raise ValueError(f"a whole number that fits in {kind}")
        return str(number)
    if kind == "bool":
        if isinstance(value, bool) or (numpy is not None and isinstance(value, numpy.bool_)):
            return "1" if value else "0"
        raise ValueError("True or False")
    if kind == "string":
        if isinstance(value, str):
            return value
        raise ValueError("a string")
    raise ValueError(f"a type FlowStudio does not know ({kind})")


def _block_sequence(value):
    if isinstance(value, (str, bytes, dict)):
        return None
    module = type(value).__module__ or ""
    if module.startswith("numpy") and hasattr(value, "ndim"):
        return value.tolist() if value.ndim == 1 else None
    if module.startswith("pandas.") and type(value).__name__ == "Series":
        return value.tolist()
    if isinstance(value, (list, tuple, range)):
        return list(value)
    return None


def _block_value(kind: str, value, line: int) -> str:
    """The value as the Flow type kind, or _BlockFailure naming the line."""
    if kind == "void":
        return ""
    if kind == "string":
        return _to_text(value)
    array = _BLOCK_ARRAY.match(kind)
    if array:
        element, size = array.group(1), int(array.group(2))
        wanted = f"array<{element}, {size}>"
        items = _block_sequence(value)
        if items is None:
            raise _BlockFailure(f"line {line}: the Python block returned {_describe(value)}; "
                                f"{wanted} needs a list of {size} values.")
        if len(items) != size:
            raise _BlockFailure(f"line {line}: the Python block returned {len(items)} values; "
                                f"{wanted} needs {size}.")
        out = []
        for index, item in enumerate(items):
            try:
                text = _block_scalar_out(element, item)
            except ValueError as reason:
                raise _BlockFailure(f"line {line}: item {index} of the Python block's value is "
                                    f"{_describe(item)}; {element} needs {reason}.") from None
            out.append(urllib.parse.quote(text, safe="-._~") if element == "string" else text)
        return "\n".join(out)
    try:
        return _block_scalar_out(kind, value)
    except ValueError as reason:
        raise _BlockFailure(f"line {line}: the Python block returned {_describe(value)}; "
                            f"{kind} needs {reason}.") from None


def block(namespace: dict, payload: str) -> tuple[bool, bytes]:
    """Run one python(...) { ... } block from a Flow program."""
    try:
        lines = _Lines(payload)
        if lines.next() != "FSBLOCK 1":
            raise ValueError("unknown block request version")
        kind = lines.next()
        line = int(lines.next())
        first = int(lines.next())
        values, code = _block_values(lines)
    except (ValueError, IndexError) as error:
        return False, f"FlowStudio could not read the block request: {error}.".encode("utf-8")
    output = io.StringIO()
    value = None
    # The passed values exist while the block runs. A session variable of
    # the same name (or a builtin such as sorted) comes back afterwards;
    # other names the block assigns stay in the session.
    missing = object()
    saved = {name: namespace.get(name, missing) for name in values}
    try:
        with contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
            # Blank lines in front give every statement its Flow line number.
            tree = ast.parse("\n" * max(0, first - 1) + code, _BLOCK_FILE, "exec")
            namespace.update(values)
            last = tree.body.pop() if tree.body and isinstance(tree.body[-1], ast.Expr) else None
            exec(compile(tree, _BLOCK_FILE, "exec"), namespace)
            if last is not None:
                expression = ast.Expression(last.value)
                ast.copy_location(expression, last)
                value = eval(compile(expression, _BLOCK_FILE, "eval"), namespace)
    except SyntaxError as error:
        text = output.getvalue() + f"line {error.lineno or first}: Python syntax error: {error.msg}"
        return False, text.encode("utf-8", "replace")
    except BaseException:
        kind_, error, trace = sys.exc_info()
        frames = [frame for frame in traceback.extract_tb(trace) if frame.filename == _BLOCK_FILE]
        where = frames[-1].lineno if frames else line
        message = "".join(traceback.format_exception_only(kind_, error)).strip()
        text = output.getvalue() + f"line {where}: Python error: {message}"
        for frame in reversed(frames[:-1]):
            text += f"\n  called from line {frame.lineno}"
        return False, text.encode("utf-8", "replace")
    finally:
        for name, before in saved.items():
            if before is missing:
                namespace.pop(name, None)
            else:
                namespace[name] = before
    printed = output.getvalue().encode("utf-8", "replace")
    if len(printed) > _BLOCK_OUTPUT_MAX:
        printed = printed[:_BLOCK_OUTPUT_MAX] + b"\n[FlowStudio: the rest of the block's output was cut]\n"
    try:
        text = _block_value(kind, value, line).encode("utf-8", "replace")
    except _BlockFailure as failure:
        return False, printed + str(failure).encode("utf-8", "replace")
    if len(printed) + len(text) > _BLOCK_REPLY_MAX:
        return False, f"line {line}: the Python block's value is larger than 120 KiB.".encode("utf-8")
    return True, str(len(printed)).encode("ascii") + b"\n" + printed + text


# ---- Flow ----------------------------------------------------------------

def _program_output(text: str) -> str:
    """The program's own output from `flow run`, without the build log."""
    marker = "-" * 40
    lines = text.split("\n")
    marks = [i for i, line in enumerate(lines) if line.strip() == marker]
    if len(marks) >= 2:
        return "\n".join(lines[marks[0] + 1:marks[-1]]).strip("\n")
    return text


def flow(program: str, input: str | None = None, timeout: float = 60.0) -> str:
    """Compile and run a Flow program; returns what it printed.

    program is a path to a .flow file or Flow source. The program may import
    flowstudio and call back: py(...) runs here in this namespace, r(...) in
    the R session.
    """
    source = program
    if "\n" not in program and program.endswith(".flow") and os.path.exists(program):
        with open(program, encoding="utf-8") as handle:
            source = handle.read()
    import flow_blocks
    try:
        text, _, found = flow_blocks.expand(source)
    except flow_blocks.BlockError as error:
        raise FlowError(error.text()) from None
    if found:
        # python(...) { ... } and r(...) { ... } blocks become bridge calls.
        source = flow_blocks.finish(text, flow_blocks.struct_fields(source))
    workdir = tempfile.mkdtemp(prefix="flowstudio-py-flow-")
    try:
        path = os.path.join(workdir, "main.flow")
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(source)
        if os.path.exists(_LIBRARY):
            shutil.copy(_LIBRARY, os.path.join(workdir, "flowstudio.flow"))
        request_read, request_write = os.pipe()
        reply_read, reply_write = os.pipe()

        def place_bridge() -> None:
            os.dup2(request_write, 3)
            os.dup2(reply_read, 4)

        env = dict(os.environ, FLOWSTUDIO_BRIDGE="1")
        process = subprocess.Popen(
            ["flow", "run", path], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT, env=env, close_fds=False, preexec_fn=place_bridge,
            start_new_session=True)
        os.close(request_write)
        os.close(reply_read)
        if input is not None:
            process.stdin.write(input.encode("utf-8"))
        process.stdin.close()
        import selectors
        import time
        selector = selectors.DefaultSelector()
        selector.register(process.stdout, selectors.EVENT_READ, "out")
        requests = os.fdopen(request_read, "rb", buffering=0)
        replies = os.fdopen(reply_write, "wb", buffering=0)
        selector.register(requests, selectors.EVENT_READ, "bridge")
        chunks: list[bytes] = []
        deadline = time.monotonic() + timeout
        open_streams = 2
        while open_streams:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                os.killpg(process.pid, 9)
                raise FlowError(f"Flow program stopped after {timeout:g} seconds.")
            for key, _ in selector.select(remaining):
                if key.data == "out":
                    data = os.read(process.stdout.fileno(), 65536)
                    if data:
                        chunks.append(data)
                        continue
                else:
                    header = requests.read(9)
                    if len(header) == 9:
                        body = _read_exact(requests, int(header[1:], 16)).decode("utf-8", "replace")
                        target, fmt, code = body[0], body[1], body[2:]
                        if target == "p":
                            ok, payload = evaluate(_namespace if _namespace is not None else {}, fmt, code)
                            text = payload.decode("utf-8", "replace")
                        else:
                            ok, text = _call(target, fmt, code)
                        data = text.encode("utf-8")
                        replies.write((b"0" if ok else b"1") + f"{len(data):08x}".encode("ascii") + data)
                        continue
                selector.unregister(key.fileobj)
                open_streams -= 1
        code = process.wait()
        requests.close()
        replies.close()
        text = b"".join(chunks).decode("utf-8", "replace")
        if code != 0:
            raise FlowError(text.strip() or f"flow exited with status {code}")
        return _program_output(text)
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
