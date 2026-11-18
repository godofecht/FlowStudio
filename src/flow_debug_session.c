/* FlowStudio Flow debugger transport. Starts src/flow_debugger.py (LLDB on a
 * source-mapped Flow build) once and exchanges framed requests with it, like
 * src/python_session.c. Flow owns the routes and the intent gate. */
#ifndef _POSIX_C_SOURCE
#define _POSIX_C_SOURCE 200809L
#endif
#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

#define FS_FD_MAX 131072
static pid_t helper_pid = -1;
static int helper_in = -1;
static int helper_out = -1;
static int fd_last_status = 503;
static int helper_ever_responded = 0;
static char fd_result[FS_FD_MAX + 1];

static int64_t now_ms(void)
{
    struct timespec t;
    if (clock_gettime(CLOCK_MONOTONIC, &t) != 0) return -1;
    return (int64_t)t.tv_sec * 1000 + t.tv_nsec / 1000000;
}

static void fd_reset(void)
{
    if (helper_in >= 0) close(helper_in);
    if (helper_out >= 0) close(helper_out);
    helper_in = helper_out = -1;
    if (helper_pid > 0) {
        kill(-helper_pid, SIGKILL);
        kill(helper_pid, SIGKILL);
        while (waitpid(helper_pid, NULL, 0) < 0 && errno == EINTR) {}
    }
    helper_pid = -1;
    helper_ever_responded = 0;
}

static int fd_start(void)
{
    if (helper_pid > 0) return 1;
    signal(SIGPIPE, SIG_IGN);
    int input[2], output[2];
    if (pipe(input) != 0) return 0;
    if (pipe(output) != 0) { close(input[0]); close(input[1]); return 0; }
    pid_t child = fork();
    if (child < 0) {
        close(input[0]); close(input[1]); close(output[0]); close(output[1]);
        return 0;
    }
    if (child == 0) {
        (void)setpgid(0, 0);
        if (dup2(input[0], STDIN_FILENO) < 0 || dup2(output[1], STDOUT_FILENO) < 0) _exit(127);
        int devnull = open("/dev/null", O_WRONLY);
        if (devnull >= 0) dup2(devnull, STDERR_FILENO);
        for (int fd = 3; fd < 1024; fd++) close(fd);
        const char *python = getenv("FLOWSTUDIO_LLDB_PYTHON");
        if (python && *python) execlp(python, python, "-u", "src/flow_debugger.py", (char *)NULL);
#if defined(__APPLE__)
        /* Xcode's Python is the one that can import LLDB's module. */
        execlp("xcrun", "xcrun", "python3", "-u", "src/flow_debugger.py", (char *)NULL);
#endif
        execlp("python3", "python3", "-u", "src/flow_debugger.py", (char *)NULL);
        _exit(127);
    }
    close(input[0]); close(output[1]);
    helper_in = input[1]; helper_out = output[0]; helper_pid = child;
    (void)setpgid(child, child);
    return 1;
}

static int fd_io(int fd, char *data, size_t length, int writing, int64_t deadline)
{
    size_t offset = 0;
    while (offset < length) {
        int64_t remaining = deadline - now_ms();
        if (remaining <= 0) return 0;
        struct pollfd p = {fd, writing ? POLLOUT : POLLIN, 0};
        int ready = poll(&p, 1, remaining > INT32_MAX ? INT32_MAX : (int)remaining);
        if (ready < 0 && errno == EINTR) continue;
        if (ready <= 0 || (p.revents & (POLLERR | POLLNVAL))) return 0;
        ssize_t n = writing ? write(fd, data + offset, length - offset) :
                              read(fd, data + offset, length - offset);
        if (n < 0 && errno == EINTR) continue;
        if (n <= 0) return 0;
        offset += (size_t)n;
    }
    return 1;
}

static const char *fd_request(char op, const char *payload, int deadline_ms)
{
    fd_result[0] = 0;
    fd_last_status = 503;
    if (!payload || strlen(payload) > FS_FD_MAX) { fd_last_status = 413; return "Debug request exceeds 128 KiB."; }
    if (!fd_start()) return "Could not start the Flow debugger helper.";
    int64_t deadline = now_ms() + deadline_ms;
    char header[10];
    size_t length = strlen(payload);
    snprintf(header, sizeof(header), "%c%08x", op, (unsigned)length);
    char reply[9];
    size_t size = 0;
    if (!fd_io(helper_in, header, 9, 1, deadline) ||
        !fd_io(helper_in, (char *)payload, length, 1, deadline) ||
        !fd_io(helper_out, reply, 9, 0, deadline)) goto failed;
    helper_ever_responded = 1;
    for (int i = 1; i < 9; i++) {
        char c = reply[i];
        int v = c >= '0' && c <= '9' ? c - '0' : c >= 'a' && c <= 'f' ? c - 'a' + 10 : -1;
        if (v < 0) goto failed;
        size = size * 16 + (size_t)v;
    }
    if ((reply[0] != '0' && reply[0] != '1') || size > FS_FD_MAX ||
        !fd_io(helper_out, fd_result, size, 0, deadline)) goto failed;
    fd_result[size] = 0;
    fd_last_status = reply[0] == '0' ? 200 : 422;
    return fd_result;
failed:
    fd_last_status = now_ms() >= deadline ? 504 : 503;
    fd_reset();
    if (fd_last_status == 504) return "The Flow debugger timed out and was reset.";
    if (!helper_ever_responded)
        return "The Flow debugger needs LLDB with Python support (Xcode command line tools on macOS, lldb and python3-lldb on Linux).";
    return "The Flow debugger stopped unexpectedly and was reset.";
}

/* op: start, step, next, finish, continue, pause, stop, status, evaluate, breakpoints */
const char *fs_flow_debug(const char *op, const char *body)
{
    if (!op) { fd_last_status = 400; return "Bad request."; }
    if (strcmp(op, "start") == 0) return fd_request('B', body ? body : "", 150000);
    if (strcmp(op, "step") == 0) return fd_request('S', "", 30000);
    if (strcmp(op, "next") == 0) return fd_request('N', "", 30000);
    if (strcmp(op, "finish") == 0) return fd_request('F', "", 30000);
    if (strcmp(op, "continue") == 0) return fd_request('C', "", 30000);
    if (strcmp(op, "pause") == 0) return fd_request('P', "", 15000);
    if (strcmp(op, "stop") == 0) return fd_request('X', "", 15000);
    if (strcmp(op, "status") == 0) return fd_request('Q', "", 15000);
    if (strcmp(op, "breakpoints") == 0) return fd_request('L', body ? body : "", 15000);
    if (strcmp(op, "evaluate") == 0) return fd_request('E', body ? body : "", 15000);
    fd_last_status = 404;
    return "Unknown debugger operation.";
}

int fs_flow_debug_status(void) { return fd_last_status; }
