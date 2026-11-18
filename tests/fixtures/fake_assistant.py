#!/usr/bin/env python3
"""A stand-in for `claude -p ... --output-format stream-json` in tests.

FlowStudio starts it with exactly the argv it gives Claude Code, the prompt
on stdin and the scrubbed environment. It speaks Claude Code's stream-json
and drives the real FlowStudio MCP server named in --mcp-config, so a test
covers the whole chain: browser, server bridge, MCP server, proposals.

The prompt picks the behaviour:
  SLEEP     print the pid and sleep (cancel and timeout tests)
  ENV       report the argv flags, cwd and billing variables it can see
  PROPOSE   propose an edit to the active file through the MCP server
  PROPOSE2  also propose an edit to the first other open file
  FlowStudio inline edit.
            an inline edit (Ctrl+K): reply with the selected lines in one
            fenced block, with integer literals on `let` lines bumped by one,
            or an undefined variable renamed when asked to fix that error
  anything  check a Flow program through MCP and answer with it
"""
import json
import os
import re
import subprocess
import sys
import time

FLOW = (
    "function twice(n: i32) -> i32 {\n"
    "    return n * 2\n"
    "}\n\n"
    "function main() -> i32 {\n"
    "    println(\"twice 21 =\", twice(21))\n"
    "    return 0\n"
    "}\n"
)


def emit(event):
    sys.stdout.write(json.dumps(event) + "\n")
    sys.stdout.flush()


def say(text, pause=0.05):
    for word in text.split(" "):
        emit({"type": "stream_event", "event": {"type": "content_block_delta", "index": 0,
                                                "delta": {"type": "text_delta", "text": word + " "}}})
        time.sleep(pause)
    emit({"type": "assistant", "message": {"content": [{"type": "text", "text": text + " "}]}})


def stream_raw(text, pause=0.04):
    """Stream text a few characters at a time, as a model writes."""
    for start in range(0, len(text), 6):
        emit({"type": "stream_event", "event": {"type": "content_block_delta", "index": 0,
                                                "delta": {"type": "text_delta", "text": text[start:start + 6]}}})
        time.sleep(pause)
    emit({"type": "assistant", "message": {"content": [{"type": "text", "text": text}]}})


def inline_edit(prompt):
    match = re.search(r"Selected lines \d+ to \d+:\n```(\w*)\n(.*?)\n```", prompt, re.S)
    language = match.group(1) if match else "flow"
    lines = match.group(2).split("\n") if match else []
    error = re.search(r"Undefined variable '(\w+)'", prompt)
    if error:
        names = [m.group(1) for m in (re.search(r"let (\w+)", line) for line in lines) if m]
        if names:
            lines = [re.sub(r"\b%s\b" % error.group(1), names[0], line) for line in lines]
    else:
        lines = [re.sub(r"\b\d+\b", lambda m: str(int(m.group(0)) + 1), line) if "let " in line else line
                 for line in lines]
    if not match:
        lines = ["# inserted by the fake assistant"]
    stream_raw("```" + language + "\n" + "\n".join(lines) + "\n```\n")


def flag(name):
    args = sys.argv[1:]
    return args[args.index(name) + 1] if name in args and args.index(name) + 1 < len(args) else None


class Mcp:
    def __init__(self):
        config = json.loads(flag("--mcp-config"))["mcpServers"]["flowstudio"]
        env = dict(os.environ)
        env.update(config.get("env") or {})
        self.proc = subprocess.Popen([config["command"]] + config["args"], stdin=subprocess.PIPE,
                                     stdout=subprocess.PIPE, text=True, env=env)
        self.next_id = 0
        self.request("initialize", {"protocolVersion": "2024-11-05", "capabilities": {},
                                    "clientInfo": {"name": "fake", "version": "1"}})

    def request(self, method, params):
        self.next_id += 1
        self.proc.stdin.write(json.dumps({"jsonrpc": "2.0", "id": self.next_id, "method": method,
                                          "params": params}) + "\n")
        self.proc.stdin.flush()
        return json.loads(self.proc.stdout.readline())

    def call(self, name, arguments, use_id):
        emit({"type": "assistant", "message": {"content": [
            {"type": "tool_use", "id": use_id, "name": "mcp__flowstudio__" + name, "input": arguments}]}})
        reply = self.request("tools/call", {"name": name, "arguments": arguments})
        result = reply.get("result") or {"content": [{"type": "text", "text": json.dumps(reply.get("error"))}],
                                         "isError": True}
        emit({"type": "user", "message": {"content": [
            {"type": "tool_result", "tool_use_id": use_id, "content": result["content"],
             "is_error": bool(result.get("isError"))}]}})
        return result

    def close(self):
        self.proc.stdin.close()
        self.proc.wait(timeout=10)


def main():
    prompt = sys.stdin.read()
    emit({"type": "system", "subtype": "init", "tools": [], "mcp_servers": [{"name": "flowstudio",
                                                                              "status": "connected"}]})
    if "SLEEP" in prompt:
        say("sleeping as pid %d" % os.getpid(), 0)
        time.sleep(60)
        return 0
    if "ENV" in prompt:
        system = flag("--append-system-prompt") or ""
        report = {
            "anthropic_key": "ANTHROPIC_API_KEY" in os.environ,
            "openai_key": "OPENAI_API_KEY" in os.environ,
            "custom_key": "SOME_SERVICE_API_KEY" in os.environ,
            "kept": os.environ.get("FLOWSTUDIO_TEST_KEEP"),
            "cwd": os.getcwd(),
            "tools": flag("--tools"),
            "allowed": flag("--allowedTools"),
            "disallowed": flag("--disallowedTools"),
            "strict": "--strict-mcp-config" in sys.argv,
            "permission": flag("--permission-mode"),
            "guide_in_system_prompt": "# Flow guide" in system and "Common compiler errors" in system,
            "mcp_env": json.loads(flag("--mcp-config"))["mcpServers"]["flowstudio"]["env"],
            "prompt": prompt,
        }
        say("ENVREPORT " + json.dumps(report), 0)
        emit({"type": "result", "subtype": "success", "is_error": False, "result": "done"})
        return 0
    if "FlowStudio inline edit." in prompt:
        mcp = Mcp()
        mcp.call("flowstudio_check_code", {"language": "flow", "code": FLOW}, "i1")
        mcp.close()
        inline_edit(prompt)
        emit({"type": "result", "subtype": "success", "is_error": False, "result": "done"})
        return 0
    mcp = Mcp()
    say("Let me look at your editor.")
    state = mcp.call("flowstudio_editor_state", {}, "t1")
    checked = mcp.call("flowstudio_check_code", {"language": "flow", "code": FLOW}, "t2")
    if "PROPOSE" in prompt:
        text = state["content"][0]["text"]
        active = text.split("\n", 1)[0].replace("Active file: ", "").rsplit(" (", 1)[0]
        mcp.call("flowstudio_propose_edit", {"file": active, "content": FLOW, "mode": "replace",
                                             "summary": "Replace with a checked program"}, "t3")
        say("I proposed a checked program for " + active + ".")
        others = re.search(r"Other open files: (.*)", text)
        if "PROPOSE2" in prompt and others:
            other = others.group(1).split(", ")[0]
            mcp.call("flowstudio_propose_edit", {"file": other, "content": "# reviewed by the assistant\n",
                                                 "mode": "insert", "line": 1, "summary": "Add a header"}, "t4")
            say("I also proposed a header for " + other + ".")
    verdict = "passed" if not checked.get("isError") else "failed"
    say("The check " + verdict + ". Here it is:\n\n```flow\n" + FLOW + "```\n")
    mcp.close()
    emit({"type": "result", "subtype": "success", "is_error": False, "result": "done"})
    return 0


if __name__ == "__main__":
    sys.exit(main())
