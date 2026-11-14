"""Flow documentation for the Help pane.

Reads a name or a topic on stdin and prints JSON. Nothing is run. The
index is built from three sources, each used only when it is present:

    stdlib   the Flow toolchain's lib/stdlib/*.flow: the signature of every
             exported function, struct, const and type, with the comment
             block written above it
    catalog  the built-in functions and keyword notes that `flow lsp` shows
             on hover (tools/lsp/catalog.flow in the toolchain)
    guide    FlowStudio's docs/FLOW_FOR_AI.md: each section is a topic, and
             its compiled examples are attached to the names they use

The toolchain is the checkout that holds the `flow` on PATH, or
FLOWSTUDIO_FLOW_ROOT. The reply:

    {"ok", "query", "entries": [exact matches, full text],
     "related": [other matches, one line each], "sources": {...}}
"""
from __future__ import annotations

import json
import os
import re
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GUIDE = os.path.join(ROOT, "docs", "FLOW_FOR_AI.md")
QUERY_LIMIT = 80
ENTRY_LIMIT = 6
RELATED_LIMIT = 40
EXAMPLE_LIMIT = 3
DOC_LIMIT = 4000
SIGNATURE_LINES = 40

DECLARATION = re.compile(
    r"^(export\s+)?(?:pub\s+)?(function|struct|enum|const|type|trait)\s+([A-Za-z_][A-Za-z0-9_]*)")
IDENT = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")


# ---- sources -------------------------------------------------------------

def flow_root() -> str | None:
    configured = os.environ.get("FLOWSTUDIO_FLOW_ROOT")
    candidates = [configured] if configured else []
    found = shutil.which("flow")
    if found:
        candidates.append(os.path.dirname(os.path.realpath(found)))
    for candidate in candidates:
        if candidate and os.path.isdir(os.path.join(candidate, "lib", "stdlib")):
            return candidate
    return None


def read(path: str) -> str:
    try:
        with open(path, encoding="utf-8", errors="replace") as handle:
            return handle.read()
    except OSError:
        return ""


def comment_above(lines: list[str], index: int) -> str:
    """The `#` comment block that ends just above line `index`, skipping
    attribute lines such as @libm."""
    at = index - 1
    while at >= 0 and lines[at].lstrip().startswith("@"):
        at -= 1
    block: list[str] = []
    while at >= 0 and lines[at].lstrip().startswith("#"):
        block.append(lines[at].lstrip()[1:].strip())
        at -= 1
    block.reverse()
    while block and not block[0].strip("=-# "):
        block.pop(0)
    return "\n".join(block).strip()


def signature_at(lines: list[str], index: int, kind: str) -> str:
    """The declaration as written: a function up to its body, a struct or
    enum with its fields, a const or type on its line."""
    out: list[str] = []
    depth = 0
    for line in lines[index:index + SIGNATURE_LINES]:
        if kind in ("function", "trait"):
            out.append(line.split("{", 1)[0].rstrip())
            depth += line.count("(") - line.count(")")
            if "{" in line or (depth <= 0 and not line.rstrip().endswith((",", "("))):
                break
        else:
            out.append(line.rstrip())
            if kind in ("const", "type") or line.strip() == "}" or (line.count("{") and line.count("}")):
                break
    text = "\n".join(out).strip()
    return re.sub(r"^export\s+", "", text)


def stdlib_entries(root: str | None) -> list[dict]:
    if not root:
        return []
    base = os.path.join(root, "lib", "stdlib")
    entries: list[dict] = []
    files = []
    for name in sorted(os.listdir(base)):
        path = os.path.join(base, name)
        if name.endswith(".flow") and os.path.isfile(path):
            files.append((name[:-5], path))
    for stem, path in files:
        lines = read(path).split("\n")
        declared = [(index, DECLARATION.match(line)) for index, line in enumerate(lines)]
        declared = [(index, match) for index, match in declared if match]
        exported = [(index, match) for index, match in declared if match.group(1)]
        for index, match in exported or declared:
            kind, name = match.group(2), match.group(3)
            entries.append({
                "name": name, "kind": kind, "signature": signature_at(lines, index, kind),
                "doc": comment_above(lines, index)[:DOC_LIMIT],
                "source": "Flow standard library", "path": "lib/stdlib/" + stem + ".flow",
                "line": index + 1, "module": "std." + stem,
                "usage": f"import std.{stem} {{ {name} }}" if kind != "trait" else ""})
    return entries


def flow_string(text: str) -> str:
    """A Flow string literal body with C escapes, as text."""
    out = bytearray()
    at = 0
    while at < len(text):
        char = text[at]
        if char == "\\" and at + 1 < len(text):
            nxt = text[at + 1]
            if nxt in "01234567":
                digits = re.match(r"[0-7]{1,3}", text[at + 1:]).group(0)
                out.append(int(digits, 8) & 0xFF)
                at += 1 + len(digits)
                continue
            out += {"n": b"\n", "t": b"\t", '"': b'"', "\\": b"\\"}.get(nxt, nxt.encode("utf-8"))
            at += 2
            continue
        out += char.encode("utf-8")
        at += 1
    return out.decode("utf-8", "replace")


def catalog_table(text: str, function: str, key: str) -> dict[str, str]:
    """`if t_eq(KEY, "x") { return "y" }` pairs from one catalog function."""
    start = text.find("export function " + function + "(")
    if start < 0:
        return {}
    end = text.find("\nexport function ", start + 1)
    body = text[start:end if end > 0 else len(text)]
    pattern = re.compile(r't_eq\(' + key + r',\s*"((?:[^"\\]|\\.)*)"\)\s*\{\s*return\s+"((?:[^"\\]|\\.)*)"', re.S)
    return {flow_string(name): flow_string(value) for name, value in pattern.findall(body)}


def catalog_entries(root: str | None) -> list[dict]:
    if not root:
        return []
    text = read(os.path.join(root, "tools", "lsp", "catalog.flow"))
    if not text:
        return []
    entries: list[dict] = []
    docs = catalog_table(text, "builtin_function_doc", "name")
    params = catalog_table(text, "builtin_function_params", "name")
    returns = catalog_table(text, "builtin_function_return", "name")
    for name, doc in docs.items():
        result = returns.get(name, "")
        entries.append({"name": name, "kind": "builtin",
                        "signature": f"function {name}({params.get(name, '')})" + (f" -> {result}" if result else ""),
                        "doc": doc, "source": "Flow built-in", "path": "tools/lsp/catalog.flow"})
    for key, markdown in catalog_table(text, "syntax_hover_text", "key").items():
        code = re.search(r"```flow\n(.*?)```", markdown, re.S)
        prose = re.sub(r"```flow\n.*?```", "", markdown, flags=re.S).strip()
        entries.append({"name": key, "kind": "keyword", "signature": "", "doc": prose,
                        "source": "Flow language notes", "path": "tools/lsp/catalog.flow",
                        "examples": [{"title": "", "code": code.group(1).rstrip(), "output": ""}] if code else []})
    return entries


def guide_sections(text: str) -> list[dict]:
    """`##` sections of the guide: prose and code blocks in order."""
    sections: list[dict] = []
    current = None
    fence = None
    block: list[str] = []
    for line in text.split("\n"):
        if fence is not None:
            if line.startswith("```"):
                current["blocks"].append({"lang": fence, "code": "\n".join(block)})
                fence = None
                block = []
            else:
                block.append(line)
            continue
        if line.startswith("```"):
            fence = line[3:].strip()
            continue
        if line.startswith("## "):
            current = {"title": line[3:].strip(), "prose": [], "blocks": []}
            sections.append(current)
            continue
        if current is not None:
            current["prose"].append(line)
    for section in sections:
        examples = []
        blocks = section["blocks"]
        for index, item in enumerate(blocks):
            if not item["lang"].startswith("flow") or item["lang"] == "flow error":
                continue
            following = blocks[index + 1] if index + 1 < len(blocks) else None
            output = following["code"] if following and following["lang"] == "output" else ""
            examples.append({"title": section["title"], "code": item["code"], "output": output})
        section["examples"] = examples
        section["doc"] = "\n".join(section.pop("prose")).strip()
    return sections


def guide_entries(sections: list[dict]) -> list[dict]:
    return [{"name": section["title"], "kind": "guide", "signature": "",
             "doc": section["doc"][:DOC_LIMIT], "source": "FlowStudio guide",
             "path": "docs/FLOW_FOR_AI.md", "examples": section["examples"][:EXAMPLE_LIMIT]}
            for section in sections]


def examples_for(name: str, sections: list[dict]) -> list[dict]:
    """Guide examples whose code uses `name` as a word."""
    if not IDENT.fullmatch(name):
        return []
    word = re.compile(r"(?<![A-Za-z0-9_.])" + re.escape(name) + r"(?![A-Za-z0-9_])")
    found = []
    for section in sections:
        for example in section["examples"]:
            code = "\n".join(line for line in example["code"].split("\n") if not line.lstrip().startswith("#"))
            if word.search(code):
                found.append(example)
                if len(found) >= EXAMPLE_LIMIT:
                    return found
    return found


def prose_items(doc: str) -> list[str]:
    """Paragraphs and `- ` bullets, with wrapped lines joined."""
    items: list[str] = []
    for line in doc.split("\n"):
        text = line.strip()
        if not text:
            items.append("")
        elif text.startswith("- ") or not items or not items[-1]:
            items.append(text)
        else:
            items[-1] += " " + text
    return [item for item in items if item]


def guide_mention(name: str, sections: list[dict]) -> dict | None:
    """For a name with no declaration of its own, such as println: the guide
    lines that name it in backticks, and the examples that use it."""
    if not IDENT.fullmatch(name):
        return None
    tick = re.compile("`" + re.escape(name) + r"[`(\s]")
    notes = []
    for section in sections:
        for item in prose_items(section["doc"]):
            if tick.search(item) and item not in notes:
                notes.append(item)
    examples = examples_for(name, sections)
    if not notes and not examples:
        return None
    return {"name": name, "kind": "guide", "signature": "", "doc": "\n".join(notes[:8])[:DOC_LIMIT],
            "source": "FlowStudio guide", "path": "docs/FLOW_FOR_AI.md", "examples": examples}


# ---- search --------------------------------------------------------------

def summary(entry: dict) -> str:
    first = (entry.get("signature") or entry.get("doc") or "").strip().split("\n")[0]
    return first[:160]


def search(query: str) -> dict:
    query = query.strip()[:QUERY_LIMIT]
    root = flow_root()
    sections = guide_sections(read(GUIDE))
    index = catalog_entries(root) + stdlib_entries(root) + guide_entries(sections)
    sources = {"stdlib": bool(root), "catalog": any(e["source"] != "Flow standard library" and
                                                     e["kind"] in ("builtin", "keyword") for e in index),
               "guide": bool(sections)}
    reply = {"ok": True, "query": query, "entries": [], "related": [], "sources": sources}
    if not query:
        reply["related"] = [{"name": e["name"], "kind": e["kind"], "source": e["source"], "summary": summary(e)}
                            for e in index if e["kind"] == "guide"]
        return reply
    lower = query.lower()
    # A dotted name such as math.sqrt or std.math.sqrt looks up its last part.
    bare = query.rsplit(".", 1)[-1] if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_.]*", query) else query
    exact = [e for e in index if e["name"] == bare or (e["kind"] == "guide" and e["name"].lower() == lower)]
    if not exact:
        exact = [e for e in index if e["name"].lower() == bare.lower()]
    order = {"builtin": 0, "keyword": 1, "function": 2, "struct": 3, "const": 4, "type": 5, "enum": 6,
             "trait": 7, "guide": 8}
    exact.sort(key=lambda e: (order.get(e["kind"], 9), e.get("path", "")))
    if not exact:
        mention = guide_mention(bare, sections)
        if mention:
            exact = [mention]
    for entry in exact[:ENTRY_LIMIT]:
        item = dict(entry)
        if entry["kind"] != "guide" and not item.get("examples"):
            item["examples"] = examples_for(entry["name"], sections)
        reply["entries"].append(item)
    seen = {(e["name"], e.get("path")) for e in exact[:ENTRY_LIMIT]}
    related = []
    for entry in index:
        if (entry["name"], entry.get("path")) in seen:
            continue
        name = entry["name"].lower()
        if name.startswith(lower):
            rank = 0
        elif lower in name:
            rank = 1
        elif entry["kind"] == "guide" and len(lower) > 2 and lower in entry["doc"].lower():
            rank = 2
        else:
            continue
        related.append((rank, order.get(entry["kind"], 9), entry["name"], entry))
    related.sort(key=lambda item: item[:3])
    reply["related"] = [{"name": e["name"], "kind": e["kind"], "source": e["source"],
                         "path": e.get("path", ""), "summary": summary(e)}
                        for *_, e in related[:RELATED_LIMIT]]
    return reply


def main() -> int:
    data = sys.stdin.buffer.read(4096).decode("utf-8", "replace")
    sys.stdout.write(json.dumps(search(data)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
