# FLOWSTUDIO-AGENT-WRAPPER
# Shared by bin/claude and bin/codex. FlowStudio's Terminal puts bin/ first
# on PATH, so typing `claude` or `codex` there starts the real CLI with the
# FlowStudio MCP server added for that one run. Nothing is written to the
# user's ~/.claude.json or ~/.codex/config.toml.
#
# The pty child (src/pty_session.c) exports:
#   FLOWSTUDIO_URL  origin of the running native server
#   FLOWSTUDIO_MCP  absolute path of mcp/flowstudio_mcp.py
# Without both, the wrapper only finds the real binary and runs it untouched.

# Print the first executable named $1 on PATH that is not a FlowStudio
# wrapper. $2 is this wrapper's own directory, resolved with pwd -P.
flowstudio_real_tool() {
  _fs_name=$1
  _fs_self=$2
  _fs_saved_ifs=$IFS
  IFS=:
  set -f
  for _fs_dir in $PATH; do
    [ -n "$_fs_dir" ] || _fs_dir=.
    _fs_candidate=$_fs_dir/$_fs_name
    [ -f "$_fs_candidate" ] && [ -x "$_fs_candidate" ] || continue
    _fs_real=$(cd "$_fs_dir" 2>/dev/null && pwd -P) || continue
    [ "$_fs_real" = "$_fs_self" ] && continue
    # A copy of this wrapper somewhere else on PATH would exec itself forever.
    if dd if="$_fs_candidate" bs=512 count=1 2>/dev/null | grep -q FLOWSTUDIO-AGENT-WRAPPER; then
      continue
    fi
    IFS=$_fs_saved_ifs
    set +f
    printf '%s\n' "$_fs_candidate"
    return 0
  done
  IFS=$_fs_saved_ifs
  set +f
  return 1
}

# Quote $1 as a JSON or TOML basic string.
flowstudio_quote() {
  printf '"%s"' "$(printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')"
}

flowstudio_agent() {
  _fs_tool=$1
  shift
  _fs_here=$(cd "$(dirname "$0")" 2>/dev/null && pwd -P)
  _fs_bin=$(flowstudio_real_tool "$_fs_tool" "$_fs_here") || {
    printf '%s: command not found\n' "$_fs_tool" >&2
    exit 127
  }
  if [ -z "${FLOWSTUDIO_URL:-}" ] || [ -z "${FLOWSTUDIO_MCP:-}" ] || [ ! -f "${FLOWSTUDIO_MCP:-}" ]; then
    exec "$_fs_bin" "$@"
  fi
  _fs_python=$(command -v python3 2>/dev/null) || _fs_python=python3
  _fs_cmd=$(flowstudio_quote "$_fs_python")
  _fs_arg=$(flowstudio_quote "$FLOWSTUDIO_MCP")
  _fs_url=$(flowstudio_quote "$FLOWSTUDIO_URL")
  case $_fs_tool in
    claude)
      # The = form keeps --mcp-config from taking the user's next argument
      # as a second config.
      exec "$_fs_bin" "--mcp-config={\"mcpServers\":{\"flowstudio\":{\"type\":\"stdio\",\"command\":$_fs_cmd,\"args\":[$_fs_arg],\"env\":{\"FLOWSTUDIO_URL\":$_fs_url}}}}" "$@"
      ;;
    codex)
      exec "$_fs_bin" \
        -c "mcp_servers.flowstudio.command=$_fs_cmd" \
        -c "mcp_servers.flowstudio.args=[$_fs_arg]" \
        -c "mcp_servers.flowstudio.env={FLOWSTUDIO_URL=$_fs_url}" \
        "$@"
      ;;
  esac
  exec "$_fs_bin" "$@"
}
