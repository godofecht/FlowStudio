"""Python and R blocks inside Flow source.

A Flow program in FlowStudio can hold Python or R code as a block:

    let m: f64 = python(xs) {
        import numpy as np
        np.mean(xs)
    }
    let fit: string = r(df) { summary(lm(y ~ x, data = df))$r.squared }

The names in parentheses are Flow values. Each is set in the session under
the same name while the block runs, typed: numbers, strings and bools as
scalars, arrays as vectors, structs as dicts or named lists, arrays of
structs as data frames.
The block's last value comes back as the Flow type of the result. That type
is written after the arguments (`python(xs) -> f64 { ... }`) or taken from
the `let` annotation when the block is the whole initializer. A block used as
a statement returns nothing; anywhere else it returns its value as text.

Flow's compiler never sees a block. FlowStudio rewrites each one into a call
of the bridge functions in src/flowstudio.flow before it checks, runs or
debugs a program. The rewrite keeps every Flow line where it was: the call
opens on the block's first line, the body lines become blank and the call
closes where the block closed. Compiler messages therefore keep their line
numbers, and the column map moves columns on rewritten lines back.

The rules, shared with web/flow_blocks.js and pinned by
tests/fixtures/flow_blocks_cases.json:

  * `python` or `r`, then optional `(names)`, optional `-> Type`, then `{`.
    The keyword starts a statement or follows `=`, `(`, `,`, `[`, an
    arithmetic or comparison operator, `return`, `and`, `or` or `not`. The
    statement does not start with if, elif, while, for, match or a
    declaration keyword.
  * When `{` ends its line, the block ends at the first later line that
    starts with `}` indented exactly like the opening line. Text after that
    `}` is Flow again. Otherwise the block is one line and ends at the last
    `}` on it.
  * An argument is a Flow name, or `name = expression`.

Types come from the Flow checker. Each block with arguments is first
replaced by a call of a probe function that takes nothing the arguments can
match; the checker's "No matching overload ... with arguments (T, U)"
message names their types. The probe is one extra strict check, about a
tenth of a second.

Command line (the native server and the debugger use these):

    flow_blocks.py expand   reads Flow source on stdin and prints the program
                            to run (exit 0), or the error (exit 2)
    flow_blocks.py check    reads Flow source on stdin, checks it the way the
                            server's strict check does and prints the
                            compiler output with block positions (exit 0 when
                            it passes, 1 when it does not)
"""
from __future__ import annotations

import json
import keyword
import os
import random
import re
import shutil
import string
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BRIDGE_MODULE = os.path.join(ROOT, "src", "flowstudio.flow")

KEYWORDS = {"python": "p", "r": "r"}
LANGUAGE_NAME = {"python": "Python", "r": "R"}
MAX_ARGUMENTS = 64
MAX_ARRAY = 100000
SCALAR_RESULTS = ("f64", "f32", "i64", "i32", "bool", "string", "void")
ARRAY_ELEMENTS = ("f64", "f32", "i64", "i32", "bool", "string")
# A statement starting with one of these words never holds a block: `if r(x) {`
# calls a function r and opens the if body.
HEADS = {"if", "elif", "while", "for", "match", "function", "struct", "enum", "extern", "import",
         "export", "type", "trait", "impl", "flow", "field", "const", "else"}
R_RESERVED = {"if", "else", "repeat", "while", "function", "for", "next", "break", "TRUE", "FALSE",
              "NULL", "Inf", "NaN", "NA", "NA_integer_", "NA_real_", "NA_complex_", "NA_character_", "in"}
INTEGER_TYPES = {"i8", "i16", "i32", "i64", "u8", "u16", "u32", "u64", "isize", "usize"}
# A block may follow one of these characters, or return, and, or, not.
AFTER = "=(,[+-*/%<>!&|"
WORD_START = set(string.ascii_letters + "_")
WORD_CHARS = set(string.ascii_letters + string.digits + "_")
NAME = re.compile(r"[A-Za-z_][A-Za-z0-9_]*$")
NAMED_ARGUMENT = re.compile(r"([A-Za-z_][A-Za-z0-9_]*)\s*=(?!=)\s*")
LET_ANNOTATION = re.compile(r"^\s*let\s+(?:mut\s+)?[A-Za-z_][A-Za-z0-9_]*\s*:\s*(.+?)\s*=\s*$")
ARRAY_RESULT = re.compile(r"^array\s*<\s*([A-Za-z0-9_]+)\s*,\s*([0-9]+)\s*>$")
SEQUENCE_TYPE = re.compile(r"^(array|span)\s*<\s*(?:mut\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*(?:,\s*[0-9]+\s*)?>$")
PROBE = re.compile(r"No matching overload for function 'flowstudio_probe_([0-9]+)' with arguments \((.*)\)\s*$")
PROBE_TYPE = "FlowStudioBlockProbe"

# Everything the rewritten program calls from src/flowstudio.flow.
RUNTIME = ("flowstudio_call", "flowstudio_f64", "flowstudio_f32", "flowstudio_i64", "flowstudio_i32",
           "flowstudio_bool", "flowstudio_fill_f64s", "flowstudio_fill_f32s", "flowstudio_fill_i64s",
           "flowstudio_fill_i32s", "flowstudio_fill_bools", "flowstudio_lines_start", "flowstudio_lines_next",
           "flowstudio_arg_f64", "flowstudio_arg_i64", "flowstudio_arg_bool", "flowstudio_arg_string",
           "flowstudio_arg_f64s", "flowstudio_arg_f32s", "flowstudio_arg_i64s", "flowstudio_arg_i32s",
           "flowstudio_arg_bools", "flowstudio_buf_start", "flowstudio_buf_put",
           "flowstudio_buf_int", "flowstudio_buf_f64", "flowstudio_buf_bool", "flowstudio_buf_str",
           "flowstudio_buf_take")
IMPORT_LINE = "import flowstudio { " + ", ".join(RUNTIME) + " }"


class BlockError(Exception):
    """A block that cannot be read or typed. line and column are 1-based."""

    def __init__(self, line: int, column: int, message: str):
        super().__init__(message)
        self.line = line
        self.column = column
        self.message = message

    def text(self) -> str:
        return f"line {self.line}: {self.message}"


class Argument:
    def __init__(self, name: str, expression: str, column: int, name_column: int):
        self.name = name
        self.expression = expression
        self.column = column            # 0-based column of the expression
        self.name_column = name_column  # 0-based column of the name

    def to_json(self) -> dict:
        return {"name": self.name, "expression": self.expression, "column": self.column}


class Block:
    def __init__(self):
        self.language = ""
        self.line = 0          # 0-based line of the keyword
        self.column = 0        # 0-based column of the keyword
        self.brace = 0         # column of the opening {
        self.end_line = 0      # 0-based line of the closing }
        self.end_column = 0    # column of the closing }
        self.inline = False
        self.arguments: list[Argument] = []
        self.declared = ""     # the type after ->, if any
        self.declared_column = -1
        self.result = ""       # the result type
        self.code = ""
        self.first_line = 0    # 1-based line of the code's first line
        self.indent = ""
        self.code_column = 0   # column in the Flow line where code text starts

    @property
    def target(self) -> str:
        return KEYWORDS[self.language]

    def to_json(self) -> dict:
        return {"language": self.language, "line": self.line, "column": self.column,
                "endLine": self.end_line, "endColumn": self.end_column, "inline": self.inline,
                "arguments": [argument.to_json() for argument in self.arguments],
                "result": self.result, "code": self.code, "firstLine": self.first_line}


# ---- finding blocks ------------------------------------------------------

def code_mask(line: str) -> str:
    """The line with Flow string contents blanked and its comment removed."""
    out = []
    quoted = escaped = False
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


def leading(line: str) -> str:
    return line[:len(line) - len(line.lstrip(" \t"))]


def statement_head(masked: str) -> str:
    text = masked.lstrip(" \t}")
    match = re.match(r"[A-Za-z_][A-Za-z0-9_]*", text)
    return match.group(0) if match else ""


def can_start_here(masked: str, column: int) -> bool:
    before = masked[:column].rstrip()
    if statement_head(masked) in HEADS:
        return False
    if not before:
        return True
    if before[-1] in AFTER:
        return True
    return re.search(r"(?:^|[^A-Za-z0-9_])(?:return|and|or|not)$", before) is not None


def matching_paren(masked: str, start: int) -> int:
    """Index of the ) that closes the ( at start, or -1."""
    depth = 0
    for index in range(start, len(masked)):
        char = masked[index]
        if char in "([{":
            depth += 1
        elif char in ")]}":
            depth -= 1
            if depth == 0:
                return index if char == ")" else -1
    return -1


def split_arguments(text: str, masked: str, offset: int) -> list[tuple[str, int]]:
    """(piece, column) for each top-level comma separated piece."""
    pieces = []
    depth = 0
    start = 0
    for index, char in enumerate(masked):
        if char in "([{":
            depth += 1
        elif char in ")]}":
            depth -= 1
        elif char == "," and depth == 0:
            pieces.append((text[start:index], offset + start))
            start = index + 1
    pieces.append((text[start:], offset + start))
    return pieces


def dedent(lines: list[str]) -> list[str]:
    widths = [leading(line) for line in lines if line.strip()]
    if not widths:
        return ["" for _ in lines]
    common = widths[0]
    for width in widths[1:]:
        while not width.startswith(common):
            common = common[:-1]
    return [line[len(common):] if line.strip() else "" for line in lines]


def normal_type(text: str) -> str:
    text = re.sub(r"\s+", " ", text.strip())
    text = re.sub(r"\s*<\s*", "<", text)
    text = re.sub(r"\s*>", ">", text)
    return re.sub(r"\s*,\s*", ", ", text)


def result_supported(kind: str) -> bool:
    if kind in SCALAR_RESULTS:
        return True
    match = ARRAY_RESULT.match(kind)
    return bool(match) and match.group(1) in ARRAY_ELEMENTS and 1 <= int(match.group(2)) <= MAX_ARRAY


def read_opener(lines: list[str], number: int, column: int, word: str):
    """The block whose keyword is at (number, column), or None when the
    keyword is an ordinary name there. Raises BlockError for a block that is
    written wrongly."""
    line = lines[number]
    masked = code_mask(line)
    if not can_start_here(masked, column):
        return None
    at = column + len(word)
    while at < len(masked) and masked[at] in " \t":
        at += 1
    arguments_text = None
    arguments_column = 0
    if at < len(masked) and masked[at] == "(":
        close = matching_paren(masked, at)
        if close < 0:
            return None
        arguments_text = line[at + 1:close]
        arguments_column = at + 1
        at = close + 1
        while at < len(masked) and masked[at] in " \t":
            at += 1
    declared = ""
    declared_column = -1
    if masked.startswith("->", at):
        brace = masked.find("{", at)
        if brace < 0:
            return None
        declared = normal_type(line[at + 2:brace])
        declared_column = at + 2 + (len(line[at + 2:brace]) - len(line[at + 2:brace].lstrip()))
        at = brace
    if at >= len(masked) or masked[at] != "{":
        return None

    block = Block()
    block.language = word
    block.line = number
    block.column = column
    block.brace = at
    block.declared = declared
    block.declared_column = declared_column
    if arguments_text is not None and arguments_text.strip():
        seen = set()
        masked_arguments = masked[arguments_column:arguments_column + len(arguments_text)]
        for piece, piece_column in split_arguments(arguments_text, masked_arguments, arguments_column):
            stripped = piece.strip()
            start = piece_column + len(piece) - len(piece.lstrip())
            if not stripped:
                raise BlockError(number + 1, start + 1, f"an empty argument in this {word} block.")
            if NAME.match(stripped):
                argument = Argument(stripped, stripped, start, start)
            else:
                named = NAMED_ARGUMENT.match(stripped)
                if not named or not stripped[named.end():].strip():
                    raise BlockError(number + 1, start + 1,
                                     f"a {word} block argument is a Flow name, or name = expression.")
                argument = Argument(named.group(1), stripped[named.end():].rstrip(), start + named.end(), start)
            if word == "python" and keyword.iskeyword(argument.name):
                raise BlockError(number + 1, argument.name_column + 1,
                                 f"'{argument.name}' is a Python keyword. Pass it as another name: other = {argument.name}.")
            if word == "r" and argument.name in R_RESERVED:
                raise BlockError(number + 1, argument.name_column + 1,
                                 f"'{argument.name}' is reserved in R. Pass it as another name: other = {argument.name}.")
            if argument.name in seen:
                raise BlockError(number + 1, argument.name_column + 1,
                                 f"'{argument.name}' is passed to this {word} block twice.")
            seen.add(argument.name)
            block.arguments.append(argument)
        if len(block.arguments) > MAX_ARGUMENTS:
            raise BlockError(number + 1, column + 1, f"a {word} block takes at most {MAX_ARGUMENTS} values.")

    rest = line[at + 1:]
    if not rest.strip() or rest.lstrip().startswith("#"):
        indent = leading(line)
        end = -1
        for later in range(number + 1, len(lines)):
            text = lines[later]
            if leading(text) == indent and text[len(indent):len(indent) + 1] == "}":
                end = later
                break
        if end < 0:
            raise BlockError(number + 1, at + 1,
                             f"this {word} block has no closing }}. Put }} on its own line, indented like the line that opens the block.")
        block.end_line = end
        block.end_column = len(indent)
        block.indent = indent
        body = lines[number + 1:end]
        block.code = "\n".join(dedent(body))
        widths = [len(leading(text)) - len(leading(text_dedented)) for text, text_dedented in zip(body, dedent(body)) if text.strip()]
        block.code_column = widths[0] if widths else 0
        block.first_line = number + 2
    else:
        close = line.rfind("}")
        if close <= at:
            raise BlockError(number + 1, at + 1,
                             f"this one-line {word} block has no closing }} on its line. A block on several lines opens with {{ at the end of its first line.")
        block.inline = True
        block.end_line = number
        block.end_column = close
        block.code = line[at + 1:close].strip()
        block.code_column = at + 1 + len(line[at + 1:close]) - len(line[at + 1:close].lstrip())
        block.first_line = number + 1

    if declared:
        block.result = declared
        where = declared_column
    else:
        prefix = line[:column]
        suffix = code_mask(lines[block.end_line][block.end_column + 1:]).strip()
        annotation = LET_ANNOTATION.match(code_mask(prefix)) if not suffix else None
        if annotation:
            block.result = normal_type(prefix[annotation.start(1):annotation.end(1)])
            where = annotation.start(1)
        elif not code_mask(prefix).strip() and not suffix:
            block.result = "void"
            where = column
        else:
            block.result = "string"
            where = column
    if not result_supported(block.result):
        raise BlockError(number + 1, where + 1,
                         f"a {word} block cannot return {block.result}. It returns f64, f32, i64, i32, bool, "
                         "string or an array of those. Write -> string to get the value as text.")
    return block


def find_blocks(source: str) -> list[Block]:
    """Every block in the source, in order. Raises BlockError."""
    lines = source.split("\n")
    blocks: list[Block] = []
    number = 0
    start = 0
    while number < len(lines):
        line = lines[number]
        masked = code_mask(line)
        index = start
        start = 0
        moved = False
        while index < len(masked):
            char = masked[index]
            if char in WORD_START:
                end = index
                while end < len(masked) and masked[end] in WORD_CHARS:
                    end += 1
                word = masked[index:end]
                previous = masked[index - 1] if index > 0 else ""
                if word in KEYWORDS and previous != ".":
                    block = read_opener(lines, number, index, word)
                    if block is not None:
                        blocks.append(block)
                        number = block.end_line
                        start = block.end_column + 1
                        moved = True
                        break
                index = end
                continue
            index += 1
        if not moved:
            number += 1
    return blocks


def has_blocks(source: str) -> bool:
    try:
        return bool(find_blocks(source))
    except BlockError:
        return True


# ---- rewriting -----------------------------------------------------------

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


def kind_code(result: str) -> str:
    match = ARRAY_RESULT.match(result)
    return f"{match.group(1)}[{int(match.group(2))}]" if match else result


def wrap(result: str) -> tuple[str, int]:
    """The text before the call and how many ) close it."""
    if result in ("f64", "f32", "i64", "i32", "bool"):
        return f"flowstudio_{result}(", 2
    match = ARRAY_RESULT.match(result)
    if match:
        return f"flowstudio_take_{match.group(1)}_{int(match.group(2))}(", 2
    return "", 1


def struct_fields(declarations: str) -> dict[str, list[tuple[str, str]] | None]:
    """struct name -> [(field, type)], or None when a field is not a scalar."""
    found: dict[str, list[tuple[str, str]] | None] = {}
    for match in re.finditer(r"(?m)^[ \t]*(?:export\s+|pub\s+)?struct\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{([^}]*)\}",
                             declarations):
        fields: list[tuple[str, str]] | None = []
        for part in re.split(r"[\n,]", match.group(2)):
            part = code_mask(part).strip()
            if not part:
                continue
            field = re.match(r"([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-z_][A-Za-z0-9_]*)$", part)
            if not field or (field.group(2) not in INTEGER_TYPES and field.group(2) not in ("f64", "f32", "bool", "string")):
                fields = None
                break
            fields.append((field.group(1), field.group(2)))
        found[match.group(1)] = fields or None
    return found


def encoder(argument: Argument, kind: str, structs: dict, block: Block) -> tuple[str, str]:
    """(text before the expression, text after it) that encodes one argument."""
    name = flow_string(argument.name)
    kind = normal_type(kind)
    if kind in ("f64", "f32"):
        return f"flowstudio_arg_f64({name}, (", ") as f64)"
    if kind in INTEGER_TYPES:
        return f"flowstudio_arg_i64({name}, (", ") as i64)"
    if kind == "bool":
        return f"flowstudio_arg_bool({name}, ", ")"
    if kind == "string":
        return f"flowstudio_arg_string({name}, ", ")"
    sequence = SEQUENCE_TYPE.match(kind)
    if sequence:
        element = sequence.group(2)
        plural = {"f64": "f64s", "f32": "f32s", "i64": "i64s", "i32": "i32s", "bool": "bools"}
        if element == "string":
            # flowc cannot pass a span of strings, so each size gets a helper.
            size = re.search(r",\s*([0-9]+)\s*>$", kind)
            if sequence.group(1) == "array" and size:
                return f"flowstudio_strings_{int(size.group(1))}({name}, ", ")"
            return unsupported(argument, kind, structs, block, kind)
        if element in plural:
            return f"flowstudio_arg_{plural[element]}({name}, ", ")"
        if structs.get(element):
            return f"flowstudio_rows_{element}({name}, ", ")"
        return unsupported(argument, kind, structs, block, element)
    if structs.get(kind):
        return f"flowstudio_rec_{kind}({name}, ", ")"
    return unsupported(argument, kind, structs, block, kind)


def unsupported(argument: Argument, kind: str, structs: dict, block: Block, element: str):
    if element in structs:
        reason = f"struct {element} has a field that is not a number, bool or string"
    elif re.match(r"[A-Z]", element) and "<" not in element:
        reason = f"FlowStudio cannot see the fields of struct {element}; declare it in this file"
    else:
        reason = f"it is {kind}"
    raise BlockError(block.line + 1, argument.column + 1,
                     f"'{argument.name}' cannot be passed to a {block.language} block: {reason}. "
                     "Blocks take numbers, bools, strings, arrays and spans of those, structs and arrays of structs.")


class Rewrite:
    """The rewritten source and a column map back to the original."""

    def __init__(self, text: str, columns: dict[int, list[tuple[int, int, int]]], fallback: dict[int, int]):
        self.text = text
        # line -> [(new column, original column, length)] for copied text
        self.columns = columns
        self.fallback = fallback  # line -> original column for anything else

    def original_column(self, line: int, column: int) -> int:
        """0-based line and column in the rewrite -> 0-based original column."""
        for new, old, length in self.columns.get(line, []):
            if new <= column < new + length or (column == new + length and length > 0):
                return old + column - new
        return self.fallback.get(line, column)


def rewrite(source: str, blocks: list[Block], types: dict[int, list[str]] | None,
            structs: dict | None = None, probe: bool = False) -> Rewrite:
    """The source with every block replaced by a call. With probe, blocks
    with arguments call flowstudio_probe_<index> instead, for the checker to
    name their types; types may then be None."""
    lines = source.split("\n")
    structs = structs or {}
    columns: dict[int, list[tuple[int, int, int]]] = {}
    fallback: dict[int, int] = {}
    # Rewrite from the last block to the first so earlier columns hold.
    for index in range(len(blocks) - 1, -1, -1):
        block = blocks[index]
        opener = lines[block.line]
        closing = lines[block.end_line]
        prefix = opener[:block.column]
        segments = [(0, 0, len(prefix))]
        if probe and block.arguments:
            head = f"flowstudio_probe_{index}("
            parts = []
            at = len(prefix) + len(head)
            for position, argument in enumerate(block.arguments):
                if position:
                    parts.append(", ")
                    at += 2
                segments.append((at, argument.column, len(argument.expression)))
                parts.append(argument.expression)
                at += len(argument.expression)
            call = head + "".join(parts)
            closers = 1
        else:
            before, closers = wrap(block.result)
            head = (before + f"flowstudio_call(\"{block.target}\", \"{kind_code(block.result)}\", "
                    f"{block.line + 1}, {block.first_line}, {flow_string(block.code)}, ")
            at = len(prefix) + len(head)
            parts = []
            kinds = (types or {}).get(index, [])
            if not block.arguments:
                parts.append('""')
            for position, argument in enumerate(block.arguments):
                if position:
                    parts.append(" + ")
                    at += 3
                left, right = encoder(argument, kinds[position] if position < len(kinds) else "?", structs, block)
                segments.append((at + len(left), argument.column, len(argument.expression)))
                piece = left + argument.expression + right
                parts.append(piece)
                at += len(piece)
            call = head + "".join(parts)
        tail_old = block.end_column + 1
        if block.inline:
            new_text = prefix + call + ")" * closers
            segments.append((len(new_text), tail_old, len(opener) - tail_old))
            lines[block.line] = new_text + opener[tail_old:]
        else:
            lines[block.line] = prefix + call
            for body in range(block.line + 1, block.end_line):
                lines[body] = ""
            head_text = block.indent + ")" * closers
            lines[block.end_line] = head_text + closing[tail_old:]
            columns[block.end_line] = [(0, 0, len(block.indent)), (len(head_text), tail_old, len(closing) - tail_old)]
            fallback[block.end_line] = block.end_column
        columns[block.line] = segments + columns.get(block.line, [])
        fallback[block.line] = block.column
    return Rewrite("\n".join(lines), columns, fallback)


def probe_declarations(blocks: list[Block]) -> list[str]:
    out = [f"struct {PROBE_TYPE} {{", "    flowstudio_unused: i32", "}"]
    for index, block in enumerate(blocks):
        if block.arguments:
            out.append(f"function flowstudio_probe_{index}(p: {PROBE_TYPE}) -> {PROBE_TYPE} {{")
            out += ["    return p", "}"]
    return out


def split_types(text: str) -> list[str]:
    out, depth, start = [], 0, 0
    for index, char in enumerate(text):
        if char in "<([":
            depth += 1
        elif char in ">)]":
            depth -= 1
        elif char == "," and depth == 0:
            out.append(text[start:index].strip())
            start = index + 1
    if text.strip():
        out.append(text[start:].strip())
    return out


def read_probe(report: str, blocks: list[Block]) -> dict[int, list[str]]:
    types: dict[int, list[str]] = {}
    for line in report.splitlines():
        match = PROBE.search(line)
        if match:
            index = int(match.group(1))
            found = split_types(match.group(2))
            if index < len(blocks) and len(found) == len(blocks[index].arguments):
                types[index] = found
    return types


def support(program: str, structs: dict) -> list[str]:
    """The generated helpers a rewritten program calls: array results and
    struct encoders. Each is generated once, from the program text."""
    out: list[str] = []
    seen = set()
    for match in re.finditer(r"\bflowstudio_take_(f64|f32|i64|i32|bool|string)_([0-9]+)\(", program):
        element, size = match.group(1), int(match.group(2))
        if (element, size) in seen:
            continue
        seen.add((element, size))
        fill = {"f64": "0.0", "f32": "0.0", "i64": "0", "i32": "0", "bool": "false", "string": '""'}[element]
        out += [f"function flowstudio_take_{element}_{size}(flowstudio_text: string) -> array<{element}, {size}> {{",
                f"    let mut flowstudio_out: array<{element}, {size}> = [{fill}]"]
        if element == "string":
            out += ["    flowstudio_lines_start(flowstudio_text)",
                    f"    for flowstudio_i in 0 to {size} {{",
                    "        flowstudio_out[flowstudio_i] = flowstudio_lines_next()", "    }"]
        else:
            plural = {"f64": "f64s", "f32": "f32s", "i64": "i64s", "i32": "i32s", "bool": "bools"}[element]
            out.append(f"    flowstudio_fill_{plural}(flowstudio_text, flowstudio_out)")
        out += ["    return flowstudio_out", "}"]
    for size in sorted({int(found) for found in re.findall(r"\bflowstudio_strings_([0-9]+)\(", program)}):
        out += [f"function flowstudio_strings_{size}(flowstudio_name: string, flowstudio_xs: array<string, {size}>) -> string {{",
                "    flowstudio_buf_start()",
                f'    flowstudio_buf_put("S\\n" + flowstudio_name + "\\n{size}\\n")',
                f"    for flowstudio_i in 0 to {size} {{",
                "        flowstudio_buf_str(flowstudio_xs[flowstudio_i])", "    }",
                "    return flowstudio_buf_take()", "}"]
    for kind, name in sorted(set(re.findall(r"\bflowstudio_(rows|rec)_([A-Za-z_][A-Za-z0-9_]*)\(", program))):
        fields = structs.get(name)
        if not fields:
            continue
        specs = "".join(f"{field_code(kind_)}\\n{field}\\n" for field, kind_ in fields)
        if kind == "rows":
            out += [f"function flowstudio_rows_{name}(flowstudio_name: string, flowstudio_rows: span<{name}>) -> string {{",
                    "    flowstudio_buf_start()",
                    '    flowstudio_buf_put("R\\n" + flowstudio_name + "\\n")',
                    "    flowstudio_buf_int(flowstudio_rows.len as i64)",
                    f'    flowstudio_buf_put("{len(fields)}\\n{specs}")',
                    "    for flowstudio_i in 0 to flowstudio_rows.len {"]
            out += [f"        {field_put(kind_, f'flowstudio_rows[flowstudio_i].{field}')}" for field, kind_ in fields]
            out += ["    }", "    return flowstudio_buf_take()", "}"]
        else:
            out += [f"function flowstudio_rec_{name}(flowstudio_name: string, flowstudio_row: {name}) -> string {{",
                    "    flowstudio_buf_start()",
                    f'    flowstudio_buf_put("d\\n" + flowstudio_name + "\\n{len(fields)}\\n{specs}")']
            out += [f"    {field_put(kind_, f'flowstudio_row.{field}')}" for field, kind_ in fields]
            out += ["    return flowstudio_buf_take()", "}"]
    return out


def field_code(kind: str) -> str:
    if kind in ("f64", "f32"):
        return "f"
    if kind == "bool":
        return "b"
    if kind == "string":
        return "s"
    return "i"


def field_put(kind: str, expression: str) -> str:
    if kind in ("f64", "f32"):
        return f"flowstudio_buf_f64({expression} as f64)"
    if kind == "bool":
        return f"flowstudio_buf_bool({expression})"
    if kind == "string":
        return f"flowstudio_buf_str({expression})"
    return f"flowstudio_buf_int({expression} as i64)"


def finish(text: str, structs: dict) -> str:
    """A whole rewritten file with its helpers and the bridge import added
    after the last line, so no line moves."""
    extra = support(text, structs)
    return text + "\n" + "\n".join(extra + [IMPORT_LINE]) + "\n"


# ---- checking ------------------------------------------------------------

def stage(source: str, prefix: str) -> tuple[str, str]:
    """A private directory under /tmp named prefix + 6 letters or digits,
    holding prog.flow and the bridge module."""
    letters = string.ascii_letters + string.digits
    for _ in range(100):
        directory = "/tmp/" + prefix + "".join(random.choice(letters) for _ in range(6))
        try:
            os.mkdir(directory, 0o700)
            break
        except FileExistsError:
            continue
    else:
        raise OSError("FlowStudio could not create a Flow check directory.")
    path = os.path.join(directory, "prog.flow")
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(source)
    if os.path.exists(BRIDGE_MODULE):
        shutil.copyfile(BRIDGE_MODULE, os.path.join(directory, "flowstudio.flow"))
    return directory, path


def strict_check(source: str, prefix: str = "flowstudio-check-") -> tuple[int, str, str]:
    """(exit code, compiler output, staged path) of the strict emitter."""
    directory, path = stage(source, prefix)
    try:
        completed = subprocess.run(
            ["flow", "tool", "compiler/scripts/flowc_emit.flow", "--strict", path, os.path.join(directory, "out.c")],
            capture_output=True, text=True, timeout=60, check=False)
        return completed.returncode, completed.stdout + completed.stderr, path
    finally:
        shutil.rmtree(directory, ignore_errors=True)


def plain_probe(probed: str, extra: list[str]) -> str:
    program = probed + "\n" + "\n".join(extra + [IMPORT_LINE]) + "\n"
    return strict_check(program, "flowstudio-probe-")[1]


def probe_types(text: str, blocks: list[Block], structs: dict, check=None) -> tuple[dict[int, list[str]], str]:
    """Argument types for every block, from one strict check of the probe.
    check(probed source, extra declarations) returns the checker's report."""
    if not any(block.arguments for block in blocks):
        return {}, ""
    probed = rewrite(text, blocks, None, structs, probe=True).text
    report = (check or plain_probe)(probed, probe_declarations(blocks) + support(probed, structs))
    return read_probe(report, blocks), report


def expand(source: str, check=None, declarations: str = "") -> tuple[str, Rewrite, list[Block]]:
    """The source with its blocks rewritten (lines unchanged), the column
    map and the blocks. Raises BlockError. check lets the console session
    probe types inside its own program; declarations adds struct
    declarations the source uses but does not hold."""
    blocks = find_blocks(source)
    if not blocks:
        return source, Rewrite(source, {}, {}), blocks
    structs = struct_fields(declarations + "\n" + source)
    types, report = probe_types(source, blocks, structs, check)
    missing = [index for index, block in enumerate(blocks) if block.arguments and index not in types]
    if missing and "parse error" in report:
        # The program does not parse. The probe rewrite keeps the lines, so
        # the real check reports the parse error where it is.
        result = rewrite(source, blocks, None, structs, probe=True)
        return result.text, result, blocks
    if missing:
        block = blocks[missing[0]]
        raise BlockError(block.line + 1, block.column + 1,
                         f"FlowStudio could not find the types of the values passed to this {block.language} block.")
    result = rewrite(source, blocks, types, structs)
    return result.text, result, blocks


def python_syntax(blocks: list[Block]) -> list[BlockError]:
    """Syntax errors in Python blocks, at their Flow lines."""
    found = []
    for block in blocks:
        if block.language != "python":
            continue
        try:
            compile("\n" * (block.first_line - 1) + block.code, "<flow>", "exec")
        except SyntaxError as error:
            line = error.lineno or block.first_line
            column = block.code_column + (error.offset or 1)
            found.append(BlockError(line, max(1, column), f"Python syntax error: {error.msg}"))
    return found


LOCATION = re.compile(r"^(\s*)(\S*?prog\.flow):([0-9]+):([0-9]+):")


def remap(report: str, mapping: Rewrite, staged: str, original: str) -> str:
    """Compiler output with columns of rewritten lines moved back and the
    probe's own lines dropped."""
    out = []
    count = len(original.split("\n"))
    for line in report.splitlines():
        match = LOCATION.match(line)
        if match:
            number = int(match.group(3))
            if number > count:
                continue  # in the generated helpers
            column = mapping.original_column(number - 1, int(match.group(4)) - 1) + 1
            line = f"{match.group(1)}{match.group(2)}:{number}:{column}:" + line[match.end():]
        out.append(line)
    return "\n".join(out)


def check_source(source: str) -> tuple[int, str]:
    """The strict check with blocks: (0 passed or 1 failed, output)."""
    path_hint = None
    try:
        text, mapping, blocks = expand(source)
    except BlockError as error:
        directory, path_hint = stage(source, "flowstudio-check-")
        shutil.rmtree(directory, ignore_errors=True)
        return 1, f"{path_hint}:{error.line}:{error.column}: error: {error.message}"
    structs = struct_fields(source)
    program = finish(text, structs) if blocks else text
    code, report, path = strict_check(program)
    report = remap(report, mapping, path, source)
    syntax = python_syntax(blocks)
    if syntax:
        report = (report + "\n" if report.strip() else "") + "\n".join(
            f"{path}:{error.line}:{error.column}: error: {error.message}" for error in syntax)
        code = code or 1
    return (0 if code == 0 else 1), report


def main(argv: list[str]) -> int:
    if len(argv) < 2 or argv[1] not in ("expand", "check", "find"):
        print("usage: flow_blocks.py expand|check|find < source.flow", file=sys.stderr)
        return 64
    source = sys.stdin.read()
    if argv[1] == "find":
        try:
            sys.stdout.write(json.dumps({"ok": True, "blocks": [block.to_json() for block in find_blocks(source)]}))
        except BlockError as error:
            sys.stdout.write(json.dumps({"ok": False, "line": error.line, "column": error.column,
                                         "message": error.message}))
        return 0
    if argv[1] == "check":
        try:
            code, output = check_source(source)
        except (OSError, subprocess.SubprocessError) as error:
            sys.stdout.write(f"FlowStudio: the Flow block check failed: {error}")
            return 3
        sys.stdout.write(output)
        return code
    try:
        text, _, blocks = expand(source)
    except BlockError as error:
        sys.stdout.write(error.text())
        return 2
    except (OSError, subprocess.SubprocessError) as error:
        sys.stdout.write(f"FlowStudio could not prepare the Python and R blocks: {error}")
        return 2
    sys.stdout.write(finish(text, struct_fields(source)) if blocks else text)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
