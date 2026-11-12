"""FlowStudio Flow debugger: LLDB on a Flow program built with source maps.

`flow debug <file> --no-launch` compiles with FLOWC_DEBUG_INFO, so the C has
`#line` directives naming the .flow file. LLDB then stops, steps and reports
frames in Flow source lines. This helper is a child of the FlowStudio server
and speaks the same framed protocol as the Python kernel: requests arrive on
stdin as one opcode byte, eight lowercase hex digits of length and a UTF-8
payload; replies go to the helper's original stdout as "0" (ok) or "1"
(failed), eight hex digits and a JSON payload. Fd 1 is then pointed at
/dev/null so stray library prints cannot corrupt a reply. (xcrun closes
descriptors above 2, so a separate protocol fd would not survive it.)
The debuggee's stdout and stderr go to a file.

Opcodes: B start, S step into, N step over, F step out, C continue,
P pause, X stop, Q status, E evaluate, L replace breakpoints.

Runs under a Python that can import lldb (xcrun python3 on macOS).
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time

try:
    sys.path.insert(0, subprocess.run(["lldb", "-P"], capture_output=True, text=True,
                                      timeout=20).stdout.strip())
    import lldb  # noqa: E402
except Exception:  # pragma: no cover - reported to the client per request
    lldb = None

WAIT_SECONDS = 4.0
MAX_FRAMES = 24
MAX_LOCALS = 40
MAX_OUTPUT = 32768
MAX_BREAKPOINTS = 64
ANSI = re.compile(r"\x1b\[[0-9;]*m")


class Session(object):
    def __init__(self):
        self.debugger = None
        self.target = None
        self.process = None
        self.listener = None
        self.workdir = None
        self.source_name = "main.flow"
        self.out_path = None
        self.state = "idle"
        self.message = ""
        self.exit_code = None
        self.line_count = 0

    # ----- lifecycle -----
    def cleanup(self):
        if self.process is not None:
            try:
                if self.process.GetState() not in (lldb.eStateExited, lldb.eStateDetached):
                    self.process.Kill()
            except Exception:
                pass
        if self.debugger is not None:
            try:
                lldb.SBDebugger.Destroy(self.debugger)
            except Exception:
                pass
        if self.workdir:
            shutil.rmtree(self.workdir, ignore_errors=True)
        self.__init__()

    def start(self, payload):
        if lldb is None:
            return self.fail("LLDB with Python support is not available on this machine.")
        try:
            request = json.loads(payload)
            source = request["source"]
            points = request.get("breakpoints", [])
            if not isinstance(source, str) or not source.strip() or len(source) > 120000:
                raise ValueError("Source must contain 1 to 120000 characters.")
            if not isinstance(points, list) or len(points) > MAX_BREAKPOINTS:
                raise ValueError("At most 64 breakpoints.")
        except (ValueError, KeyError, TypeError) as error:
            return self.fail(str(error))
        self.cleanup()
        self.line_count = len(source.splitlines())
        self.workdir = tempfile.mkdtemp(prefix="flowstudio-debug-")
        path = os.path.join(self.workdir, self.source_name)
        with open(path, "w") as handle:
            handle.write(source)
        # `import flowstudio` must resolve; bridge calls report that the
        # bridge is unavailable while a program runs under the debugger.
        library = os.path.join(os.path.dirname(os.path.abspath(__file__)), "flowstudio.flow")
        if os.path.exists(library):
            shutil.copy(library, os.path.join(self.workdir, "flowstudio.flow"))
        build = subprocess.run(["flow", "debug", path, "--no-launch"], cwd=self.workdir,
                               capture_output=True, text=True, timeout=120)
        text = ANSI.sub("", build.stdout + build.stderr)
        match = re.search(r"Built debug binary: (\S+)", text)
        if build.returncode != 0 or not match:
            lines = [line for line in text.splitlines() if line.strip() and "ensure_flowc" not in line
                     and not line.lstrip().startswith(("\u2139", "\u2705"))]
            return self.fail("Flow build failed:\n" + "\n".join(lines[-30:]))
        binary = match.group(1)

        self.debugger = lldb.SBDebugger.Create()
        self.debugger.SetAsync(True)
        self.target = self.debugger.CreateTarget(binary)
        if not self.target or not self.target.IsValid():
            return self.fail("LLDB could not load the debug binary.")
        placed = self.place(points)
        if placed == 0:
            # No usable breakpoint: stop at the first line of main, like
            # stepping into the program.
            self.target.BreakpointCreateByName("main")
        self.out_path = os.path.join(self.workdir, "output.txt")
        info = lldb.SBLaunchInfo(None)
        info.SetWorkingDirectory(self.workdir)
        info.AddOpenFileAction(0, "/dev/null", True, False)
        info.AddOpenFileAction(1, self.out_path, False, True)
        info.AddOpenFileAction(2, self.out_path, False, True)
        self.listener = self.debugger.GetListener()
        error = lldb.SBError()
        self.process = self.target.Launch(info, error)
        if not error.Success() or not self.process or not self.process.IsValid():
            return self.fail("Launch failed: " + (error.GetCString() or "unknown error"))
        self.state = "running"
        self.wait()
        if self.state == "paused" and placed == 0:
            self.leave_runtime()
        return self.reply(True)

    def place(self, points):
        """Create source-line breakpoints; returns how many resolved."""
        self.user_breakpoints = []
        placed = 0
        for point in points:
            line = point.get("line") if isinstance(point, dict) else point
            if not isinstance(line, int) or not 1 <= line <= self.line_count:
                continue
            bp = self.target.BreakpointCreateByLocation(self.source_name, line)
            condition = point.get("condition") if isinstance(point, dict) else None
            if isinstance(condition, str) and condition.strip():
                bp.SetCondition(condition.strip()[:200])
            self.user_breakpoints.append(bp.GetID())
            if bp.GetNumLocations():
                placed += 1
        return placed

    def set_breakpoints(self, payload):
        if self.target is None or self.state not in ("paused", "running"):
            self.message = "No program is being debugged."
            return self.reply(False)
        try:
            points = json.loads(payload).get("breakpoints", [])
        except (ValueError, AttributeError):
            self.message = "Expected {\"breakpoints\": [...]}."
            return self.reply(False)
        for bp_id in getattr(self, "user_breakpoints", []):
            self.target.BreakpointDelete(bp_id)
        # The entry stop on main is a one-time stop; drop it too.
        for bp in list(self.target.breakpoint_iter()):
            self.target.BreakpointDelete(bp.GetID())
        self.place(points if isinstance(points, list) else [])
        self.message = ""
        return self.reply(True)

    def fail(self, message):
        self.state = "error" if self.state != "idle" or self.workdir else "idle"
        self.message = message[:4000]
        return self.reply(False)

    # ----- execution control -----
    def wait(self, seconds=WAIT_SECONDS):
        """Wait for the next real stop or exit, driven by LLDB state events."""
        deadline = time.time() + seconds
        event = lldb.SBEvent()
        while time.time() < deadline:
            if not self.listener.WaitForEvent(1, event):
                continue
            if not lldb.SBProcess.EventIsProcessEvent(event):
                continue
            state = lldb.SBProcess.GetStateFromEvent(event)
            if state == lldb.eStateStopped:
                if lldb.SBProcess.GetRestartedFromEvent(event):
                    continue
                if not self.has_stop_reason():
                    continue
                self.state = "paused"
                return
            if state in (lldb.eStateExited, lldb.eStateCrashed, lldb.eStateDetached):
                self.exit_code = self.process.GetExitStatus()
                self.state = "done" if state == lldb.eStateExited else "error"
                if state != lldb.eStateExited:
                    self.message = "The program crashed."
                return
        self.state = "running"

    def has_stop_reason(self):
        for thread in self.process:
            if thread.GetStopReason() not in (lldb.eStopReasonNone, lldb.eStopReasonInvalid):
                self.process.SetSelectedThread(thread)
                return True
        return False

    def drain(self):
        event = lldb.SBEvent()
        while self.listener.GetNextEvent(event):
            pass

    def in_flow(self, frame):
        entry = frame.GetLineEntry()
        spec = entry.GetFileSpec()
        return bool(spec) and spec.GetFilename() == self.source_name and entry.GetLine() > 0

    def leave_runtime(self):
        """After stepping into C runtime code, return to the nearest Flow line."""
        for _ in range(24):
            if self.state != "paused":
                return
            thread = self.process.GetSelectedThread()
            frame = thread.GetFrameAtIndex(0)
            if self.in_flow(frame):
                return
            self.drain()
            if any(self.in_flow(thread.GetFrameAtIndex(i)) for i in range(1, min(thread.GetNumFrames(), 8))):
                thread.StepOut()
            else:
                thread.StepOver()
            self.wait()

    def control(self, op):
        if self.process is None or self.state not in ("paused", "running"):
            self.message = "No program is being debugged."
            return self.reply(False)
        if op == "P":
            if self.state == "running":
                self.process.Stop()
                self.wait(3.0)
                self.leave_runtime()
            return self.reply(True)
        if self.state != "paused":
            self.message = "The program is running. Pause it first."
            return self.reply(False)
        thread = self.process.GetSelectedThread()
        self.message = ""
        self.drain()
        if op == "C":
            self.process.Continue()
        elif op == "S":
            thread.StepInto()
        elif op == "N":
            thread.StepOver()
        elif op == "F":
            thread.StepOut()
        self.state = "running"
        self.wait()
        if op in ("S", "N", "F"):
            self.leave_runtime()
        return self.reply(True)

    def stop(self):
        self.cleanup()
        self.state = "idle"
        self.message = "Stopped."
        return self.reply(True)

    def status(self):
        if self.process is not None and self.state == "running":
            self.wait(0.2)
        return self.reply(True)

    def evaluate(self, expression):
        if self.state != "paused":
            self.message = "Evaluate needs a paused program."
            return self.reply(False)
        expression = expression.strip()[:200]
        frame = self.process.GetSelectedThread().GetFrameAtIndex(0)
        value = frame.EvaluateExpression(expression)
        error = value.GetError()
        if error and error.Fail():
            result = {"expression": expression, "error": (error.GetCString() or "failed").strip()[:500]}
        else:
            result = {"expression": expression, "type": value.GetTypeName() or "",
                      "value": describe(value)}
        reply = self.snapshot()
        reply["evaluation"] = result
        return True, reply

    # ----- reporting -----
    def snapshot(self):
        frames = []
        if self.process is not None and self.state == "paused":
            thread = self.process.GetSelectedThread()
            for index in range(min(thread.GetNumFrames(), 64)):
                frame = thread.GetFrameAtIndex(index)
                if not self.in_flow(frame):
                    continue
                line = frame.GetLineEntry().GetLine()
                frames.append({"function": frame.GetFunctionName() or "?", "line": line,
                               "locals": frame_locals(frame, line, index == 0)})
                if len(frames) >= MAX_FRAMES:
                    break
        output = ""
        if self.out_path and os.path.exists(self.out_path):
            with open(self.out_path, "rb") as handle:
                handle.seek(0, 2)
                size = handle.tell()
                handle.seek(max(0, size - MAX_OUTPUT))
                output = handle.read().decode("utf-8", "replace")
        return {"state": self.state, "stack": frames, "output": output,
                "message": self.message, "exit_code": self.exit_code, "lldb": lldb is not None}

    def reply(self, ok):
        return ok, self.snapshot()


def describe(value):
    summary = value.GetSummary()
    raw = value.GetValue()
    text = summary if summary else raw
    if text is None and value.GetNumChildren():
        parts = []
        for i in range(min(value.GetNumChildren(), 6)):
            child = value.GetChildAtIndex(i)
            parts.append("%s=%s" % (child.GetName(), child.GetSummary() or child.GetValue()))
        text = "{" + ", ".join(parts) + ("..." if value.GetNumChildren() > 6 else "") + "}"
    return (text or "")[:200]


def frame_locals(frame, line, top):
    result = {}
    values = frame.GetVariables(True, True, False, True)
    for i in range(values.GetSize()):
        value = values.GetValueAtIndex(i)
        name = value.GetName()
        if not name or name.startswith("__"):
            continue
        # In the paused frame, hide locals declared on or below the paused line:
        # their storage holds garbage until the declaration runs.
        declared = value.GetDeclaration().GetLine()
        if top and declared and declared >= line and not value.GetValueType() == lldb.eValueTypeVariableArgument:
            continue
        result[name[:80]] = {"type": (value.GetTypeName() or "")[:80], "value": describe(value)}
        if len(result) >= MAX_LOCALS:
            break
    return result


def read_exact(stream, size):
    data = b""
    while len(data) < size:
        chunk = stream.read(size - len(data))
        if not chunk:
            return None
        data += chunk
    return data


def main():
    session = Session()
    out = os.fdopen(os.dup(1), "wb", buffering=0)
    devnull = os.open(os.devnull, os.O_WRONLY)
    os.dup2(devnull, 1)
    sys.stdout = open(os.devnull, "w")
    stdin = sys.stdin.buffer
    while True:
        header = read_exact(stdin, 9)
        if header is None:
            break
        op = chr(header[0])
        size = int(header[1:9], 16)
        payload = read_exact(stdin, size) if size else b""
        if payload is None:
            break
        text = payload.decode("utf-8", "replace")
        try:
            if op == "B":
                ok, body = session.start(text)
            elif op in ("S", "N", "F", "C", "P"):
                ok, body = session.control(op)
            elif op == "X":
                ok, body = session.stop()
            elif op == "Q":
                ok, body = session.status()
            elif op == "E":
                ok, body = session.evaluate(text)
            elif op == "L":
                ok, body = session.set_breakpoints(text)
            else:
                ok, body = False, {"state": session.state, "message": "Unknown operation."}
        except Exception as error:  # keep the helper alive for the next request
            ok, body = False, {"state": session.state, "stack": [], "output": "",
                               "message": "Debugger error: %s" % error}
        data = json.dumps(body, ensure_ascii=True, separators=(",", ":")).encode("utf-8")
        if len(data) > 120000:
            body["stack"] = body.get("stack", [])[:4]
            body["output"] = body.get("output", "")[-4000:]
            data = json.dumps(body, ensure_ascii=True, separators=(",", ":")).encode("utf-8")
        out.write(("0" if ok else "1").encode() + ("%08x" % len(data)).encode() + data)
    session.cleanup()


if __name__ == "__main__":
    main()
