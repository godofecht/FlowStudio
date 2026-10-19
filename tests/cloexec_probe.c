/* Real C bridge regression: compile from repository root.
 * cc -std=c11 -Wall -Wextra -Werror tests/cloexec_probe.c -o /tmp/cloexec_probe
 * /tmp/cloexec_probe
 */
#include "../src/http_bridge.c"
int main(void)
{
    int pipes[2];
    if (pipe(pipes) != 0) return 1;
    int original = fcntl(pipes[0], F_GETFD);
    if (original < 0 || fcntl(pipes[0], F_SETFD, original & ~FD_CLOEXEC) != 0)
        return 2;
    if (!fs_set_cloexec(pipes[0])) return 3;
    int flags = fcntl(pipes[0], F_GETFD);
    close(pipes[0]);
    close(pipes[1]);
    return flags >= 0 && (flags & FD_CLOEXEC) ? 0 : 4;
}
