/* Native persistent R session transport. Flow owns routing and lifecycle.
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

#define FS_R_MAX 131072
#define FS_R_DEADLINE_MS 15000
/* Package installation and update may compile source packages. */
#define FS_R_INSTALL_DEADLINE_MS 180000
static pid_t kernel_pid = -1;
static int kernel_in = -1;
static int kernel_out = -1;
static int last_status = 503;
static int kernel_ever_responded = 0;
static int busy = 0;
const char *fs_bridge_dispatch(char caller, const char *payload, size_t length, int *ok);
int fs_bridge_reply(int fd, int ok, const char *text);
static char result[FS_R_MAX + 1];

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

void fs_r_reset(void)
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
    kernel_ever_responded = 0;
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
        execlp("Rscript", "Rscript", "--vanilla", "src/r_kernel.R", (char *)NULL);
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

static const char *request_r_inner(char operation, const char *code);
static const char *request_r(char operation, const char *code)
{
    busy = 1;
    const char *reply = request_r_inner(operation, code);
    busy = 0;
    return reply;
}

static const char *request_r_inner(char operation, const char *code)
{
    result[0] = 0;
    last_status = 503;
    if (!code || strlen(code) > FS_R_MAX)
    {
        last_status = 413;
        return "R source exceeds the 128 KiB limit.";
    }
    if (!start_kernel()) return "Could not launch persistent R kernel.";
    int64_t now = milliseconds();
    if (now < 0)
    {
        fs_r_reset();
        return "Monotonic clock unavailable.";
    }
    int64_t deadline = now + ((operation == 'N' || operation == 'V') ? FS_R_INSTALL_DEADLINE_MS : FS_R_DEADLINE_MS);
    char header[10];
    size_t source_length = strlen(code);
    snprintf(header, sizeof(header), "%c%08x", operation, (unsigned)source_length);
    if (!io_exact(kernel_in, header, 9, 1, deadline) ||
        !io_exact(kernel_in, (char *)code, source_length, 1, deadline)) goto failed;
    char response_header[9];
    /* While the code runs it may call another language: relay each "Q"
     * request frame through the bridge and answer it on the kernel's stdin. */
    for (;;)
    {
        if (!io_exact(kernel_out, response_header, 9, 0, deadline)) goto failed;
        kernel_ever_responded = 1;
        if (response_header[0] != 'Q') break;
        size_t request_size = 0;
        if (!decode_hex(response_header + 1, &request_size) || request_size > FS_R_MAX + 2) goto failed;
        char *request = malloc(request_size + 1);
        if (!request) goto failed;
        if (!io_exact(kernel_out, request, request_size, 0, deadline)) { free(request); goto failed; }
        int bridge_ok = 0;
        const char *reply = fs_bridge_dispatch('r', request, request_size, &bridge_ok);
        free(request);
        if (!fs_bridge_reply(kernel_in, bridge_ok, reply)) goto failed;
    }
    size_t size = 0;
    if ((response_header[0] != '0' && response_header[0] != '1') ||
        !decode_hex(response_header + 1, &size) || size > FS_R_MAX) goto failed;
    if (!io_exact(kernel_out, result, size, 0, deadline)) goto failed;
    result[size] = 0;
    last_status = response_header[0] == '0' ? 200 : 422;
    return result;
failed:
    last_status = milliseconds() >= deadline ? 504 : 503;
    fs_r_reset();
    if (last_status == 504)
        return "R session timed out and was reset.";
    if (!kernel_ever_responded)
        return "The R interpreter (Rscript) was not found or failed to start. "
               "Install R and restart FlowStudio.";
    return "R session disconnected and was reset.";
}

const char *fs_r_run(const char *code) { return request_r('E', code); }
const char *fs_r_debug_start(const char *source) { return request_r('B', source); }
const char *fs_r_debug_step(void) { return request_r('S', ""); }
const char *fs_r_debug_continue(const char *line) { return request_r('F', line); }
const char *fs_r_debug_evaluate(const char *source) { return request_r('W', source); }
const char *fs_r_debug_stop(void) { return request_r('D', ""); }
const char *fs_r_debug_status(void) { return request_r('Q', ""); }
const char *fs_r_check(const char *code) { return request_r('C', code); }
const char *fs_r_inspect(void) { return request_r('I', ""); }
const char *fs_r_table(const char *name) { return request_r('T', name); }
const char *fs_r_plot(void) { return request_r('P', ""); }
const char *fs_r_packages(void) { return request_r('K', ""); }
const char *fs_r_load_package(const char *name) { return request_r('L', name); }
const char *fs_r_install_package(const char *name) { return request_r('N', name); }
const char *fs_r_remove_package(const char *name) { return request_r('U', name); }
const char *fs_r_update_package(const char *name) { return request_r('V', name); }
int fs_r_status(void) { return last_status; }

/* Bridge entry points: request is a format char followed by source. */
const char *fs_r_bridge_eval(const char *request) { return request_r('Y', request); }
int fs_r_bridge_ok(void) { return last_status == 200; }
int fs_r_busy(void) { return busy; }
