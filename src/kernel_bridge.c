/* FlowStudio persistent interpreter transport (POSIX/macOS/Linux).
 * Fixed interpreters, bounded framed requests, monotonic deadlines.
 * The user code is trusted and executes with the server user's privileges.
 */
#define _POSIX_C_SOURCE 200809L
#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <spawn.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

extern char **environ;

enum { FS_KERNEL_MAX_CODE = 65536, FS_KERNEL_MAX_OUTPUT = 1048576, FS_KERNEL_TIMEOUT_MS = 5000 };
typedef struct { pid_t pid; int input; int output; } FsKernel;
static FsKernel fs_kernels[2] = {{0, -1, -1}, {0, -1, -1}};
static char fs_response[FS_KERNEL_MAX_OUTPUT + 1];
static int fs_success = 0;
static int fs_http_status = 503;
static int fs_registered = 0;

static int64_t fs_clock_ms(void);

static void fs_error_status(int status, const char *message)
{
    fs_success = 0;
    fs_http_status = status;
    snprintf(fs_response, sizeof(fs_response), "%s", message);
}

static void fs_error(const char *message)
{
    fs_error_status(503, message);
}

static void fs_io_error(const char *message, int64_t deadline)
{
    int64_t now = fs_clock_ms();
    fs_error_status(now >= deadline && now >= 0 ? 504 : 503, message);
}

static int64_t fs_clock_ms(void)
{
    struct timespec ts;
    if (clock_gettime(CLOCK_MONOTONIC, &ts) != 0) return -1;
    return (int64_t)ts.tv_sec * 1000 + ts.tv_nsec / 1000000;
}

static int fs_wait_fd(int fd, short events, int64_t deadline)
{
    for (;;)
    {
        int64_t now = fs_clock_ms();
        if (now < 0 || now >= deadline) return 0;
        int remaining = (int)(deadline - now);
        struct pollfd pfd = {fd, events, 0};
        int rc = poll(&pfd, 1, remaining);
        if (rc < 0 && errno == EINTR) continue;
        if (rc <= 0 || (pfd.revents & (POLLERR | POLLNVAL))) return 0;
        if (pfd.revents & (events | POLLHUP)) return 1;
    }
}

static int fs_write_deadline(int fd, const void *data, size_t size, int64_t deadline)
{
    const char *p = (const char *)data;
    while (size > 0)
    {
        if (!fs_wait_fd(fd, POLLOUT, deadline)) return 0;
        ssize_t n = write(fd, p, size);
        if (n < 0 && (errno == EINTR || errno == EAGAIN || errno == EWOULDBLOCK)) continue;
        if (n <= 0) return 0;
        p += n;
        size -= (size_t)n;
    }
    return 1;
}

static int fs_read_deadline(int fd, void *data, size_t size, int64_t deadline)
{
    char *p = (char *)data;
    while (size > 0)
    {
        if (!fs_wait_fd(fd, POLLIN, deadline)) return 0;
        ssize_t n = read(fd, p, size);
        if (n < 0 && (errno == EINTR || errno == EAGAIN || errno == EWOULDBLOCK)) continue;
        if (n <= 0) return 0;
        p += n;
        size -= (size_t)n;
    }
    return 1;
}

static int fs_read_header(int fd, char *header, size_t cap, int64_t deadline)
{
    for (size_t i = 0; i + 1 < cap; i++)
    {
        if (!fs_read_deadline(fd, header + i, 1, deadline)) return 0;
        if (header[i] == '\n')
        {
            header[i + 1] = 0;
            return 1;
        }
    }
    return 0;
}

static void fs_stop(FsKernel *kernel)
{
    if (kernel->input >= 0) close(kernel->input);
    if (kernel->output >= 0) close(kernel->output);
    if (kernel->pid > 0)
    {
        /* Spawned with its own process group; terminate children as well. */
        (void)kill(-kernel->pid, SIGKILL);
        int status;
        while (waitpid(kernel->pid, &status, 0) < 0 && errno == EINTR) {}
    }
    kernel->pid = 0;
    kernel->input = -1;
    kernel->output = -1;
}

void fs_kernel_close(int id)
{
    if (id < 1 || id > 2) return;
    fs_stop(&fs_kernels[id - 1]);
}

static void fs_shutdown(void)
{
    fs_kernel_close(1);
    fs_kernel_close(2);
}

int fs_kernel_start(const char *language)
{
    int id = language && strcmp(language, "python") == 0 ? 1 :
             language && strcmp(language, "r") == 0 ? 2 : -1;
    if (id < 0)
    {
        fs_error("Unsupported persistent interpreter");
        return -1;
    }
    FsKernel *kernel = &fs_kernels[id - 1];
    if (kernel->pid > 0) return id;
    if (!fs_registered)
    {
        signal(SIGPIPE, SIG_IGN);
        atexit(fs_shutdown);
        fs_registered = 1;
    }
    int to_child[2] = {-1, -1};
    int from_child[2] = {-1, -1};
    if (pipe(to_child) != 0 || pipe(from_child) != 0)
    {
        if (to_child[0] >= 0) close(to_child[0]);
        if (to_child[1] >= 0) close(to_child[1]);
        if (from_child[0] >= 0) close(from_child[0]);
        if (from_child[1] >= 0) close(from_child[1]);
        fs_error("Cannot create interpreter pipes");
        return -1;
    }
    posix_spawn_file_actions_t actions;
    posix_spawnattr_t attributes;
    posix_spawn_file_actions_init(&actions);
    posix_spawn_file_actions_adddup2(&actions, to_child[0], STDIN_FILENO);
    posix_spawn_file_actions_adddup2(&actions, from_child[1], STDOUT_FILENO);
    posix_spawn_file_actions_addclose(&actions, to_child[1]);
    posix_spawn_file_actions_addclose(&actions, from_child[0]);
    posix_spawnattr_init(&attributes);
    posix_spawnattr_setflags(&attributes, POSIX_SPAWN_SETPGROUP);
    posix_spawnattr_setpgroup(&attributes, 0);
    char *python_args[] = {"python3", "-u", "scripts/python_kernel.py", NULL};
    char *r_args[] = {"R", "--vanilla", "--slave", "--file=scripts/r_kernel.R", NULL};
    char **args = id == 1 ? python_args : r_args;
    pid_t pid = 0;
    int rc = posix_spawnp(&pid, args[0], &actions, &attributes, args, environ);
    posix_spawnattr_destroy(&attributes);
    posix_spawn_file_actions_destroy(&actions);
    close(to_child[0]);
    close(from_child[1]);
    if (rc != 0)
    {
        close(to_child[1]);
        close(from_child[0]);
        fs_error("Interpreter executable missing or could not start");
        return -1;
    }
    /* Avoid blocking writes beyond the deadline on full pipes. */
    int in_flags = fcntl(to_child[1], F_GETFL, 0);
    int out_flags = fcntl(from_child[0], F_GETFL, 0);
    if (in_flags < 0 || out_flags < 0 ||
        fcntl(to_child[1], F_SETFL, in_flags | O_NONBLOCK) != 0 ||
        fcntl(from_child[0], F_SETFL, out_flags | O_NONBLOCK) != 0)
    {
        close(to_child[1]);
        close(from_child[0]);
        (void)kill(-pid, SIGKILL);
        int status;
        while (waitpid(pid, &status, 0) < 0 && errno == EINTR) {}
        fs_error("Cannot configure interpreter pipes");
        return -1;
    }
    kernel->pid = pid;
    kernel->input = to_child[1];
    kernel->output = from_child[0];
    fs_success = 1;
    fs_http_status = 200;
    fs_response[0] = 0;
    return id;
}

static const char *fs_exchange(int id, char command, const char *source)
{
    fs_error("Invalid interpreter session");
    if (id < 1 || id > 2 || fs_kernels[id - 1].pid <= 0) return fs_response;
    if (!source) source = "";
    size_t length = strlen(source);
    if (length > FS_KERNEL_MAX_CODE)
    {
        fs_error_status(413, "Source exceeds the 64 KiB request limit");
        return fs_response;
    }
    if (command != 'E' && length != 0)
    {
        fs_error_status(400, "Invalid kernel command payload");
        return fs_response;
    }
    FsKernel *kernel = &fs_kernels[id - 1];
    int64_t now = fs_clock_ms();
    if (now < 0)
    {
        fs_error("Monotonic clock unavailable");
        return fs_response;
    }
    int64_t deadline = now + FS_KERNEL_TIMEOUT_MS;
    char header[48];
    int count = snprintf(header, sizeof(header), "%c %zu\n", command, length);
    if (count <= 0 || (size_t)count >= sizeof(header) ||
        !fs_write_deadline(kernel->input, header, (size_t)count, deadline) ||
        !fs_write_deadline(kernel->input, source, length, deadline))
    {
        fs_io_error("Interpreter input failed or timed out; session closed", deadline);
        fs_stop(kernel);
        return fs_response;
    }
    char response_header[48];
    if (!fs_read_header(kernel->output, response_header, sizeof(response_header), deadline))
    {
        fs_io_error("Interpreter response failed or timed out; session closed", deadline);
        fs_stop(kernel);
        return fs_response;
    }
    int good = strncmp(response_header, "OK ", 3) == 0;
    if (!good && strncmp(response_header, "ERR ", 4) != 0)
    {
        fs_error("Interpreter returned an invalid frame; session closed");
        fs_stop(kernel);
        return fs_response;
    }
    const char *number = response_header + (good ? 3 : 4);
    errno = 0;
    char *end = NULL;
    unsigned long bytes = strtoul(number, &end, 10);
    if (errno || end == number || !end || strcmp(end, "\n") != 0 || bytes > FS_KERNEL_MAX_OUTPUT)
    {
        fs_error("Interpreter returned an invalid frame length; session closed");
        fs_stop(kernel);
        return fs_response;
    }
    if (!fs_read_deadline(kernel->output, fs_response, (size_t)bytes, deadline))
    {
        fs_io_error("Interpreter output failed or timed out; session closed", deadline);
        fs_stop(kernel);
        return fs_response;
    }
    fs_response[bytes] = 0;
    fs_success = good;
    fs_http_status = good ? 200 : 422;
    return fs_response;
}

const char *fs_kernel_eval(int id, const char *source)
{
    return fs_exchange(id, 'E', source);
}

const char *fs_kernel_inspect(int id)
{
    return fs_exchange(id, 'I', "");
}

int fs_kernel_ok(void)
{
    return fs_success;
}

int fs_kernel_status(void)
{
    return fs_http_status;
}

int fs_kernel_reset(int id)
{
    if (id < 1 || id > 2) return 0;
    fs_kernel_close(id);
    return fs_kernel_start(id == 1 ? "python" : "r") == id;
}
