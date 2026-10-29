# Authenticated remote access over SSH (partial)

FlowStudio is a **single-user, loopback-only** native Flow application. It runs
user-supplied Flow, R and Python with the privileges of the remote OS account.
**Do not** bind its HTTP listener to a public interface, reverse-proxy it onto
the internet, or treat its HTTP endpoints as authenticated multi-user APIs.

A remote developer can connect to an already-running FlowStudio process using
the local SSH forwarding helper. SSH authenticates the connecting user and
encrypts the connection; FlowStudio's own HTTP server and persistent kernels
remain unchanged and still listen only on the remote host's 127.0.0.1:8751.

On the **remote** Linux/macOS machine, install Flow 2.0.0, build FlowStudio
using the documented native build and start it from the repository root:

~~~sh
sh scripts/build.sh
./build/flowstudio
~~~

Configure OpenSSH access with a verified/pinned host key in the local
`known_hosts` file, an authorized SSH public key for the remote account,
and a server policy that permits local TCP forwarding to 127.0.0.1:8751.
Verify the server is owned by the intended account; do not share this account
or run the native server on an untrusted multi-user machine.

On the **local** machine (with OpenSSH client installed), from the FlowStudio
repository root:

~~~sh
python3 scripts/ssh_tunnel.py researcher@compute.example
# For a nonstandard SSH port or an explicit private key:
python3 scripts/ssh_tunnel.py researcher@compute.example --ssh-port 2222 --identity ~/.ssh/id_ed25519
~~~

Open **http://127.0.0.1:8751/** in the local browser after the helper reports
that the real remote `/health` endpoint is ready. The helper refuses an
occupied local port; it cannot choose a different local port because the
native Flow HTTP origin and Host restrictions require exactly 8751. Press
Ctrl+C to close the tunnel. It does not start or stop the remote FlowStudio
server, execute remote shell commands, install SSH keys, change firewall
rules, or manage the remote account.

The helper invokes OpenSSH with argv (no shell), an explicit SSH username and
validated hostname, strict host-key verification, non-interactive public-key
authentication, disabled agent/X11 forwarding, and an IPv4 loopback-only
forward from local port 8751 to remote port 8751. It checks that the port is
initially free, requires a successful exact HTTP health response, fails if
SSH exits early, and terminates its child process on startup failure or
interrupt. SSH credentials and trust configuration are owned by OpenSSH,
not by FlowStudio.

## Limitations and acceptance

**Partial, not RStudio Server parity.** SSH authenticates access to the
remote machine, **not individual HTTP requests**. Other processes or users
with access to either host's loopback network may reach the forwarded server.
There is no per-user session isolation, token login, TLS termination, remote
process lifecycle management, concurrent-user isolation, or authorization
inside FlowStudio. All users of a shared remote OS account would share
the same R/Python kernel and code-execution privileges.

Run `python3 -m unittest discover -s tests -p test_ssh_tunnel.py -v` for
command policy, rejection, cleanup and actual local HTTP health checks.
These tests do **not** establish successful SSH authentication, encrypted
forwarding, remote Flow compilation, or physical browser acceptance.
A real two-machine test with pinned host key, running remote FlowStudio,
real SSH authentication, editor execution, origin rejection and disconnect
is required before marking remote access end-to-end tested.

No hosted CI configuration or Flow-native server binding was changed.
