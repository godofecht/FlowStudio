#!/usr/bin/env python3
"""Live native FlowStudio console-integration acceptance; requires running server."""
import urllib.request

BASE = "http://127.0.0.1:8751"


def get(path):
    with urllib.request.urlopen(BASE + path, timeout=5) as response:
        assert response.status == 200, (path, response.status)
        return response.headers.get_content_type(), response.read().decode("utf-8")


def main():
    mime, page = get("/")
    assert mime == "text/html", mime
    assert 'id="console"' in page
    assert "src='/console.js'" in page
    assert "src='/workspace_console.js'" in page
    assert page.index("src='/console.js'") < page.index("src='/workspace_console.js'")
    for path, marker in (("/console.js", "FlowStudioConsole"),
                         ("/workspace_console.js", "FlowStudioWorkspaceConsole")):
        mime, code = get(path)
        assert mime == "text/javascript", (path, mime)
        assert marker in code, path
    print("PASS: native editor serves integrated console and both JavaScript assets")


if __name__ == "__main__":
    main()
