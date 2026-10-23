/* Native persistent Python session transport. Flow owns routing and lifecycle.
 * One session per loopback FlowStudio process; not a sandbox or multiuser kernel.
 */
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

#define FS_PY_MAX 131072
#define FS_PY_DEADLINE_MS 15000
static pid_t kernel_pid = -1;
static int kernel_in = -1;
static int kernel_out = -1;
static int last_status = 503;
static char result[FS_PY_MAX + 1];

static int64_t milliseconds(void)
{
    struct timespec t;
    if (clock_gettime(CLOCK_MONOTONIC, &t) != 0) return -1;
    return (int64_t)t.tv_sec * 1000 + t.tv_nsec / 1000000;
}

static void close_fd(int *fd)
{
    if (*fd >= 0) close(*fd);
    *fd = -1;
}

void fs_py_reset(void)
{
    close_fd(&kernel_in);
    close_fd(&kernel_out);
    if (kernel_pid > 0)
    {
        /* The interpreter and its descendants are a separate process group. */
        kill(-kernel_pid, SIGKILL);
        kill(kernel_pid, SIGKILL);
        while (waitpid(kernel_pid, NULL, 0) < 0 && errno == EINTR) {}
    }
    kernel_pid = -1;
}

static int start_kernel(void)
{
    if (kernel_pid > 0) return 1;
    /* A kernel can exit between requests; EPIPE must be reported, not fatal. */
    signal(SIGPIPE, SIG_IGN);
    int input[2], output[2];
    if (pipe(input) != 0) return 0;
    if (pipe(output) != 0)
    {
        close(input[0]); close(input[1]);
        return 0;
    }
    pid_t child = fork();
    if (child < 0)
    {
        close(input[0]); close(input[1]);
        close(output[0]); close(output[1]);
        return 0;
    }
    if (child == 0)
    {
        (void)setpgid(0, 0);
        /* Keep protocol fd 3 separate from user-visible stdout/stderr. */
        if (dup2(input[0], STDIN_FILENO) < 0) _exit(127);
        if (dup2(output[1], 3) < 0) _exit(127);
        int devnull = open("/dev/null", O_WRONLY);
        if (devnull < 0 || dup2(devnull, STDOUT_FILENO) < 0 ||
            dup2(devnull, STDERR_FILENO) < 0) _exit(127);
        for (int fd = 4; fd < 1024; fd++) close(fd);
        if (devnull > 3) close(devnull);
        execlp("python3", "python3", "-u", "src/python_kernel.py", (char *)NULL);
        _exit(127);
    }
    close(input[0]); close(output[1]);
    kernel_in = input[1]; kernel_out = output[0]; kernel_pid = child;
    /* Also guard the interval before child setpgid executes. */
    (void)setpgid(child, child);
    return 1;
}

static int io_exact(int fd, char *data, size_t length, int writing, int64_t deadline)
{
    size_t offset = 0;
    while (offset < length)
    {
        int64_t remaining = deadline - milliseconds();
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

static int decode_hex(const char *digits, size_t *value)
{
    size_t n = 0;
    for (int i = 0; i < 8; i++)
    {
        char c = digits[i];
        int v = c >= '0' && c <= '9' ? c - '0' :
                c >= 'a' && c <= 'f' ? c - 'a' + 10 : -1;
        if (v < 0) return 0;
        n = n * 16 + (size_t)v;
    }
    *value = n;
    return 1;
}

static const char *request_python(char operation, const char *code)
{
    result[0] = 0;
    last_status = 503;
    if (!code || strlen(code) > FS_PY_MAX)
    {
        last_status = 413;
        return "Python source exceeds the 128 KiB limit.";
    }
    if (!start_kernel()) return "Could not launch persistent Python kernel.";
    int64_t now = milliseconds();
    if (now < 0)
    {
        fs_py_reset();
        return "Monotonic clock unavailable.";
    }
    int64_t deadline = now + FS_PY_DEADLINE_MS;
    char header[10];
    size_t source_length = strlen(code);
    snprintf(header, sizeof(header), "%c%08x", operation, (unsigned)source_length);
    if (!io_exact(kernel_in, header, 9, 1, deadline) ||
        !io_exact(kernel_in, (char *)code, source_length, 1, deadline)) goto failed;
    char response_header[9];
    if (!io_exact(kernel_out, response_header, 9, 0, deadline)) goto failed;
    size_t size = 0;
    if ((response_header[0] != '0' && response_header[0] != '1') ||
        !decode_hex(response_header + 1, &size) || size > FS_PY_MAX) goto failed;
    if (!io_exact(kernel_out, result, size, 0, deadline)) goto failed;
    result[size] = 0;
    last_status = response_header[0] == '0' ? 200 : 422;
    return result;
failed:
    last_status = milliseconds() >= deadline ? 504 : 503;
    fs_py_reset();
    return last_status == 504 ? "Python session timed out and was reset." :
                                "Python session disconnected and was reset.";
}

const char *fs_py_run(const char *code) { return request_python('E', code); }
const char *fs_py_inspect(void) { return request_python('I', ""); }
int fs_py_status(void) { return last_status; }
