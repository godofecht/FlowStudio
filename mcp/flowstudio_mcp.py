#!/usr/bin/env python3
"""FlowStudio MCP server: stdio JSON-RPC bridge to the native loopback API.

Run:  python3 mcp/flowstudio_mcp.py
      FLOWSTUDIO_URL=http://127.0.0.1:8751 python3 mcp/flowstudio_mcp.py Speaks the Model Context Protocol framing on stdin/stdout
(JSON-RPC 2.0, one message per line, Content-Length framing also accepted)
and forwards tool calls to the FlowStudio native HTTP server on
127.0.0.1:8751 with the same guarded headers the browser uses
(X-FlowStudio-Intent: run and an allowed Origin). Every POST body is the
source text itself, exactly as the IDE sends it. No execution happens in
this process; code runs on your machine with your own user permissions
through the FlowStudio native server, which stays loopback-only.

Standard library only: this file must run without pip installs so the MCP
host can spawn it on any Python 3.9+ interpreter.
"""

import json
import os
import sys
import urllib.error
import urllib.request

SERVER_VERSION = "0.2.0"
PROTOCOL_VERSION = "2024-11-05"
BASE_URL = os.environ.get("FLOWSTUDIO_URL", "http://127.0.0.1:8751").rstrip("/")
READ_TIMEOUT = float(os.environ.get("FLOWSTUDIO_MCP_TIMEOUT", "75"))

LANGUAGE_HINTS = {
    "flow": "flow",
    "flow-mlir": "flow",
    "mathflow": "mathflow",
    "python": "python",
    "py": "python",
    "r": "r",
}

# The FlowStudio native server reads POST bodies as the source text. These
# routes are exposed as tools; nothing else is proxied.
RUN_ROUTES = {
    "flow": "/api/run/flow",
    "flow-mlir": "/api/run/flow",
    "mathflow": "/api/run/mathflow",
    "python": "/api/run/python",
    "r": "/api/run/r",
}


def post(path, body, language=None):
    headers = {
        "X-FlowStudio-Intent": "run",
        "Origin": "http://127.0.0.1:8751",
    }
    if language:
        headers["X-FlowStudio-Language"] = language
    request = urllib.request.Request(
        BASE_URL + path, data=body.encode("utf-8"), headers=headers, method="POST"
    )
    try:
        with urllib.request.urlopen(request, timeout=READ_TIMEOUT) as response:
            return response.status, response.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as error:
        return error.code, error.read().decode("utf-8", "replace")
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        return 0, "FlowStudio native server unreachable at %s: %s" % (BASE_URL, error)


def get(path):
    try:
        with urllib.request.urlopen(BASE_URL + path, timeout=10) as response:
            return response.status, response.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as error:
        return error.code, error.read().decode("utf-8", "replace")
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        return 0, "FlowStudio native server unreachable at %s: %s" % (BASE_URL, error)


def short_text(result, text):
    body = text.strip()
    if len(body) > 20000:
        body = body[:20000] + "\n... (truncated at 20000 chars)"
    if 200 <= result < 300:
        return {"content": [{"type": "text", "text": body if body else "(no output)"}]}
    return {
        "content": [{"type": "text", "text": "HTTP %s: %s" % (result, body)}],
        "isError": True,
    }


TOOLS = [
    {
        "name": "flowstudio_health",
        "description": (
            "Check that the FlowStudio native server is running and report "
            "its loopback URL. Always call this first if other tools fail."
        ),
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "flowstudio_run_code",
        "description": (
            "Execute source through the FlowStudio native server on this "
            "machine and return its real output. language: 'flow' (compiled "
            "C backend), 'flow-mlir' (Flow compiled through the MLIR/LLVM "
            "pipeline), 'mathflow' (checked mathematical Flow DSL), "
            "'python', or 'r'. The body is the exact program source. "
            "Flow compiled runs are capped at 60 s, Python/R at 15 s. Code "
            "runs with your user's local permissions: never run untrusted "
            "code. The server cwd is the FlowStudio project root, so "
            "relative data paths like data/samples.csv work there."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "language": {
                    "type": "string",
                    "enum": ["flow", "flow-mlir", "mathflow", "python", "r"],
                },
                "code": {"type": "string"},
            },
            "required": ["language", "code"],
        },
    },
    {
        "name": "flowstudio_check_code",
        "description": (
            "Parse-check source without executing it. For 'flow' this emits "
            "the strict typed C translation (parse and type errors only, no "
            "link or run); for 'mathflow' it validates the equation DSL. "
            "Only flow and mathflow support check."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "language": {"type": "string", "enum": ["flow", "mathflow"]},
                "code": {"type": "string"},
            },
            "required": ["language", "code"],
        },
    },
    {
        "name": "flowstudio_read_workspace_file",
        "description": (
            "Read a UTF-8 text file from the FlowStudio project root on this "
            "machine. Paths are relative (for example 'data/samples.csv', "
            "'src/main.flow'). Only files inside the project root are "
            "allowed; absolute paths, '..' segments and symlinks that leave "
            "the root are refused."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "path": {"type": "string"},
            },
            "required": ["path"],
        },
    },
    {
        "name": "flowstudio_write_workspace_file",
        "description": (
            "Create or overwrite a UTF-8 text file inside the FlowStudio "
            "project root. The same path rules as read apply: relative, "
            "inside the root, no '..'. Use this to drop a .flow file into "
            "the workspace, then run it with flowstudio_run_code."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "path": {"type": "string"},
                "content": {"type": "string"},
            },
            "required": ["path", "content"],
        },
    },
    {
        "name": "flowstudio_flow_help",
        "description": (
            "Look up an offline Flow 2.0.0 language reference entry, for "
            "example 'for', 'import', 'let', 'struct', match or the pipe "
            "operator '|>'. Returns the grounded syntax and the spec anchor; "
            "the reference is the language specification, not a runtime "
            "symbol inspector."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "topic": {"type": "string"},
            },
            "required": ["topic"],
        },
    },
]


def tool_health(_args):
    status, body = get("/health")
    return short_text(status, body)


def normalize_language(language):
    return LANGUAGE_HINTS.get((language or "").strip().lower(), "")


def tool_run_code(args):
    language = normalize_language(args.get("language"))
    route = RUN_ROUTES.get(language) or RUN_ROUTES.get((args.get("language") or "").strip().lower())
    if not route or route not in RUN_ROUTES.values():
        return {
            "content": [{"type": "text", "text": "Unknown or missing language."}],
            "isError": True,
        }
    code = args.get("code") or ""
    if not isinstance(code, str) or not code.strip():
        return {
            "content": [{"type": "text", "text": "Empty code is not executed."}],
            "isError": True,
        }
    if len(code.encode("utf-8")) > 131072:
        return {
            "content": [{"type": "text", "text": "Source exceeds the 128 KiB limit."}],
            "isError": True,
        }
    if language == "flow-mlir":
        status, body = post("/api/run/flow-mlir", code)
    else:
        status, body = post(route, code, language=language)
    return short_text(status, body)


def tool_check_code(args):
    language = (args.get("language") or "").strip().lower()
    code = args.get("code") or ""
    if language == "flow":
        status, body = post("/api/check/flow", code)
    elif language == "mathflow":
        status, body = post("/api/check/mathflow", code)
    else:
        return {
            "content": [{"type": "text", "text": "check supports 'flow' and 'mathflow'."}],
            "isError": True,
        }
    return short_text(status, body)


def safe_relative_path(raw):
    if not isinstance(raw, str) or not raw.strip():
        return None
    path = raw.strip()
    if path.startswith("/") or path.startswith("~"):
        return None
    if "\\" in path or "\x00" in path:
        return None
    if any(part in ("", "..") for part in path.split("/")):
        return None
    if any(ord(character) < 32 for character in path):
        return None
    return path


PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def tool_read_workspace_file(args):
    from pathlib import Path
    path = safe_relative_path(args.get("path"))
    if path is None:
        return {
            "content": [{"type": "text", "text": "Refused: path must be relative and inside the project root."}],
            "isError": True,
        }
    target = (Path(PROJECT_ROOT) / path).resolve()
    root = Path(PROJECT_ROOT).resolve()
    if not str(target).startswith(str(root) + os.sep):
        return {
            "content": [{"type": "text", "text": "Refused: path escapes the project root."}],
            "isError": True,
        }
    if not target.is_file():
        return {
            "content": [{"type": "text", "text": "Not a file in the workspace: %s" % path}],
            "isError": True,
        }
    try:
        text = target.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as error:
        return {
            "content": [{"type": "text", "text": "Read failed: %s" % error}],
            "isError": True,
        }
    return short_text(200, text)


def tool_write_workspace_file(args):
    from pathlib import Path
    path = safe_relative_path(args.get("path"))
    content = args.get("content")
    if path is None:
        return {
            "content": [{"type": "text", "text": "Refused: path must be relative and inside the project root."}],
            "isError": True,
        }
    if not isinstance(content, str):
        return {
            "content": [{"type": "text", "text": "Refused: content must be a string."}],
            "isError": True,
        }
    if len(content.encode("utf-8")) > 2097152:
        return {
            "content": [{"type": "text", "text": "Refused: content exceeds the 2 MiB limit."}],
            "isError": True,
        }
    target = (Path(PROJECT_ROOT) / path).resolve()
    root = Path(PROJECT_ROOT).resolve()
    if target == root or not str(target).startswith(str(root) + os.sep):
        return {
            "content": [{"type": "text", "text": "Refused: path escapes the project root."}],
            "isError": True,
        }
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
    except OSError as error:
        return {
            "content": [{"type": "text", "text": "Write failed: %s" % error}],
            "isError": True,
        }
    return short_text(200, "wrote %s (%d bytes)" % (path, len(content.encode("utf-8"))))


def tool_flow_help(args):
    topic = (args.get("topic") or "").strip().lower()
    if not topic:
        return {
            "content": [{"type": "text", "text": "flow_help needs a topic."}],
            "isError": True,
        }
    here = os.path.dirname(os.path.abspath(__file__))
    docs_app = os.path.join(os.path.dirname(here), "docs", "app", "flow_help.js")
    try:
        with open(docs_app, encoding="utf-8") as handle:
            source = handle.read()
    except OSError as error:
        return {
            "content": [{"type": "text", "text": "Offline reference unavailable: %s" % error}],
            "isError": True,
        }
    # The reference is a plain JS object literal; extract the entry without
    # executing JavaScript.
    marker = '"' + topic + '": ['
    start = source.find(marker)
    if start < 0:
        topics = [
            fragment.strip().strip('"')
            for fragment in source.split('": [')
            if fragment
        ]
        known = sorted(set(topic_fragment for topic_fragment in topics[:60]))
        return {
            "content": [{
                "type": "text",
                "text": "No bundled Flow reference entry for '%s'. Known topics include: %s." % (topic, ", ".join(known)),
            }],
            "isError": True,
        }
    begin = start + len(marker)
    depth = 1
    index = begin
    while index < len(source) and depth > 0:
        character = source[index]
        if character == "[":
            depth += 1
        elif character == "]":
            depth -= 1
        index += 1
    raw = source[begin:index - 1] if depth == 0 else source[begin:start + 400]
    doc_text = raw.split('",', 1)[-1].strip().strip('",')
    doc_text = doc_text.encode().decode("unicode_escape")
    return short_text(200, doc_text)


HANDLERS = {
    "flowstudio_health": tool_health,
    "flowstudio_run_code": tool_run_code,
    "flowstudio_check_code": tool_check_code,
    "flowstudio_read_workspace_file": tool_read_workspace_file,
    "flowstudio_write_workspace_file": tool_write_workspace_file,
    "flowstudio_flow_help": tool_flow_help,
}


def reply(message, result):
    response = {"jsonrpc": "2.0", "id": message.get("id"), "result": result}
    write_message(response)


def write_message(message):
    sys.stdout.write(json.dumps(message, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def read_message():
    # Line framing first (Claude Code, most clients); Content-Length also
    # accepted for clients that use LSP-style framing. One loop handles both:
    # a line that parses as a Content-Length header sets the length, a blank
    # line terminates the header block (returning the framed body), and any
    # other non-empty line is the message itself under line framing.
    length = None
    while True:
        line = sys.stdin.readline()
        if not line:
            # EOF: an explicit Content-Length must not silently lose its body.
            return None
        line = line.strip()
        if not line:
            if length is not None:
                return sys.stdin.read(length) if length > 0 else ""
            continue
        name, _, value = line.partition(":")
        headers_value = value.strip()
        if name.strip().lower() == "content-length" and headers_value.isdigit():
            length = int(headers_value)
            continue
        return line


def handle(message):
    method = message.get("method")
    message_id = message.get("id")
    if method == "initialize":
        reply(message, {
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {"tools": {}},
            "serverInfo": {
                "name": "flowstudio",
                "version": SERVER_VERSION,
                "title": "FlowStudio native API",
            },
            "instructions": (
                "Tools run code through the FlowStudio native server on this "
                "machine (loopback only). Executions use your local user "
                "permissions; do not run untrusted code. Flow for loops "
                "iterate numeric ranges (`for i in 0 to n`); there is no "
                "Reader iterator in Flow 2.0.0."
            ),
        })
        return
    if method == "notifications/initialized":
        return
    if method == "ping":
        reply(message, {})
        return
    if method == "tools/list":
        reply(message, {"tools": TOOLS})
        return
    if method == "tools/call":
        name = (message.get("params") or {}).get("name")
        arguments = (message.get("params") or {}).get("arguments") or {}
        handler = HANDLERS.get(name)
        if not handler:
            write_message({
                "jsonrpc": "2.0", "id": message_id,
                "error": {"code": -32602, "message": "Unknown tool: %s" % name},
            })
            return
        try:
            result = handler(arguments)
        except Exception as error:  # tool boundary: report, never crash stdio
            result = {"content": [{"type": "text", "text": "Tool failed: %s" % error}], "isError": True}
        reply(message, result)
        return
    if method.startswith("notifications/"):
        return
    write_message({
        "jsonrpc": "2.0", "id": message_id,
        "error": {"code": -32601, "message": "Method not found: %s" % method},
    })


def main():
    while True:
        raw = read_message()
        if raw is None:
            return 0
        try:
            message = json.loads(raw)
        except json.JSONDecodeError:
            write_message({
                "jsonrpc": "2.0", "id": None,
                "error": {"code": -32700, "message": "Parse error"},
            })
            continue
        handle(message)


if __name__ == "__main__":
    sys.exit(main())
