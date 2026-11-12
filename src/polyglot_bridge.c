/* Cross-language bridge between Flow programs and the persistent Python and
 * R sessions. A caller asks for another language with a "Q" frame:
 *
 *   'Q' + 8 hex digits + target ('p' or 'r') + format + source
 *
 * and is answered with '0' (ok) or '1' (error) + 8 hex digits + text. The
 * format names how the target returns its value: 'j' JSON for Python
 * callers, 'r' R source for R callers, 't' plain text for Flow programs.
 *
 * Python and R raise Q frames on their protocol pipe while they execute; the
 * session transports relay them here. Flow programs get the same channel on
 * fds 3 and 4 through fs_flow_run_bridged. A language that is already busy
 * waiting on a call cannot be re-entered; that request gets an error reply.
 */
#ifndef _POSIX_C_SOURCE
#define _POSIX_C_SOURCE 200809L
#endif
#if defined(__APPLE__) && !defined(_DARWIN_C_SOURCE)
#define _DARWIN_C_SOURCE
#endif
#ifndef _XOPEN_SOURCE
#define _XOPEN_SOURCE 700
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

#define FS_BRIDGE_MAX 131072
#define FS_FLOW_OUTPUT_MAX (1024 * 1024)
#define FS_FLOW_DEADLINE_MS 60000

const char *fs_py_bridge_eval(const char *request);
int fs_py_bridge_ok(void);
int fs_py_busy(void);
const char *fs_r_bridge_eval(const char *request);
int fs_r_bridge_ok(void);
int fs_r_busy(void);

static int64_t now_ms(void)
{
    struct timespec t;
    if (clock_gettime(CLOCK_MONOTONIC, &t) != 0) return 0;
    return (int64_t)t.tv_sec * 1000 + t.tv_nsec / 1000000;
}

/* Runs one bridge request. caller is 'p', 'r' or 'f' (Flow). payload holds
 * target + format + source. Returns the reply text; *ok is 1 on success. */
const char *fs_bridge_dispatch(char caller, const char *payload, size_t length, int *ok)
{
    static char request[FS_BRIDGE_MAX + 2];
    *ok = 0;
    if (length < 2) return "Malformed bridge request.";
    char target = payload[0];
    if (target != 'p' && target != 'r') return "Unknown bridge target; use Python or R.";
    if (target == caller)
        return "A language cannot call itself through the bridge.";
    if (length - 1 > FS_BRIDGE_MAX) return "Bridge request exceeds the 128 KiB limit.";
    /* request = format char + source, NUL-terminated for the transports. */
    memcpy(request, payload + 1, length - 1);
    request[length - 1] = 0;
    if (strlen(request) != length - 1) return "Bridge requests cannot contain NUL bytes.";
    const char *reply;
    if (target == 'p')
    {
        if (fs_py_busy()) return "Python is busy running the code that started this call; it cannot be re-entered.";
        reply = fs_py_bridge_eval(request);
        *ok = fs_py_bridge_ok();
    }
    else
    {
        if (fs_r_busy()) return "R is busy running the code that started this call; it cannot be re-entered.";
        reply = fs_r_bridge_eval(request);
        *ok = fs_r_bridge_ok();
    }
    return reply;
}

static int write_all(int fd, const char *data, size_t length)
{
    while (length > 0)
    {
        ssize_t n = write(fd, data, length);
        if (n < 0 && errno == EINTR) continue;
        if (n <= 0) return 0;
        data += n;
        length -= (size_t)n;
    }
    return 1;
}

/* Writes a '0'/'1' + 8 hex + text reply frame. */
int fs_bridge_reply(int fd, int ok, const char *text)
{
    size_t length = strlen(text);
    char header[10];
    snprintf(header, sizeof(header), "%c%08x", ok ? '0' : '1', (unsigned)length);
    return write_all(fd, header, 9) && write_all(fd, text, length);
}

/* ---- Flow programs with the bridge on fds 3 and 4 ---------------------- */

static int flow_status = 503;
static void tidy_output(int succeeded);
static char *flow_output = NULL;
static size_t flow_used = 0;

static void append_output(const char *data, size_t length)
{
    if (flow_used >= FS_FLOW_OUTPUT_MAX) return;
    if (length > FS_FLOW_OUTPUT_MAX - flow_used) length = FS_FLOW_OUTPUT_MAX - flow_used;
    memcpy(flow_output + flow_used, data, length);
    flow_used += length;
    flow_output[flow_used] = 0;
}

static int copy_file(const char *from, const char *to)
{
    FILE *in = fopen(from, "rb");
    if (!in) return 0;
    FILE *out = fopen(to, "wb");
    if (!out) { fclose(in); return 0; }
    char buffer[8192];
    size_t n;
    int ok = 1;
    while ((n = fread(buffer, 1, sizeof(buffer), in)) > 0)
        if (fwrite(buffer, 1, n, out) != n) { ok = 0; break; }
    fclose(in);
    if (fclose(out) != 0) ok = 0;
    return ok;
}

static int read_exact_deadline(int fd, char *data, size_t length, int64_t deadline)
{
    size_t offset = 0;
    while (offset < length)
    {
        int64_t remaining = deadline - now_ms();
        if (remaining <= 0) return 0;
        struct pollfd p = {fd, POLLIN, 0};
        int ready = poll(&p, 1, (int)remaining);
        if (ready < 0 && errno == EINTR) continue;
        if (ready <= 0) return 0;
        ssize_t n = read(fd, data + offset, length - offset);
        if (n < 0 && errno == EINTR) continue;
        if (n <= 0) return 0;
        offset += (size_t)n;
    }
    return 1;
}

static void remove_run_dir(const char *dir)
{
    char path[256];
    snprintf(path, sizeof(path), "%s/main.flow", dir);
    unlink(path);
    snprintf(path, sizeof(path), "%s/flowstudio.flow", dir);
    unlink(path);
    rmdir(dir);
}

/* Compiles and runs a Flow program with `flow run`, relaying bridge calls
 * to the Python and R sessions while it runs. stdout and stderr are merged
 * in order. The program sits in a private directory next to flowstudio.flow
 * so `import flowstudio { ... }` resolves. */
const char *fs_flow_run_bridged(const char *code)
{
    free(flow_output);
    flow_output = malloc(FS_FLOW_OUTPUT_MAX + 1);
    flow_used = 0;
    flow_status = 503;
    if (!flow_output) return "Out of memory.";
    flow_output[0] = 0;
    char dir[] = "/tmp/flowstudio-run-XXXXXX";
    if (!mkdtemp(dir)) return "FlowStudio: unable to create a Flow run directory.";
    char source_path[256], library_path[256];
    snprintf(source_path, sizeof(source_path), "%s/main.flow", dir);
    snprintf(library_path, sizeof(library_path), "%s/flowstudio.flow", dir);
    FILE *source = fopen(source_path, "wb");
    if (!source || fputs(code, source) < 0 || fclose(source) != 0)
    {
        remove_run_dir(dir);
        return "FlowStudio: unable to write the Flow source.";
    }
    (void)copy_file("src/flowstudio.flow", library_path);

    int out_pipe[2], request_pipe[2], reply_pipe[2];
    if (pipe(out_pipe) != 0) { remove_run_dir(dir); return "FlowStudio: pipe failed."; }
    if (pipe(request_pipe) != 0)
    {
        close(out_pipe[0]); close(out_pipe[1]);
        remove_run_dir(dir);
        return "FlowStudio: pipe failed.";
    }
    if (pipe(reply_pipe) != 0)
    {
        close(out_pipe[0]); close(out_pipe[1]);
        close(request_pipe[0]); close(request_pipe[1]);
        remove_run_dir(dir);
        return "FlowStudio: pipe failed.";
    }
    signal(SIGPIPE, SIG_IGN);
    pid_t child = fork();
    if (child < 0)
    {
        close(out_pipe[0]); close(out_pipe[1]);
        close(request_pipe[0]); close(request_pipe[1]);
        close(reply_pipe[0]); close(reply_pipe[1]);
        remove_run_dir(dir);
        return "FlowStudio: unable to start flow.";
    }
    if (child == 0)
    {
        (void)setpgid(0, 0);
        int devnull = open("/dev/null", O_RDONLY);
        /* Move the bridge ends out of the way before placing them on 3 and 4. */
        int req = fcntl(request_pipe[1], F_DUPFD, 10);
        int rep = fcntl(reply_pipe[0], F_DUPFD, 10);
        int out = fcntl(out_pipe[1], F_DUPFD, 10);
        if (devnull < 0 || req < 0 || rep < 0 || out < 0) _exit(127);
        if (dup2(devnull, STDIN_FILENO) < 0 || dup2(out, STDOUT_FILENO) < 0 ||
            dup2(out, STDERR_FILENO) < 0 || dup2(req, 3) < 0 || dup2(rep, 4) < 0) _exit(127);
        for (int fd = 5; fd < 1024; fd++) close(fd);
        setenv("FLOWSTUDIO_BRIDGE", "1", 1);
        execlp("flow", "flow", "run", source_path, (char *)NULL);
        const char *message = "Process error: flow was not found on PATH.\n";
        (void)!write(STDOUT_FILENO, message, strlen(message));
        _exit(127);
    }
    (void)setpgid(child, child);
    close(out_pipe[1]); close(request_pipe[1]); close(reply_pipe[0]);
    int out_fd = out_pipe[0], request_fd = request_pipe[0], reply_fd = reply_pipe[1];
    int64_t deadline = now_ms() + FS_FLOW_DEADLINE_MS;
    int timed_out = 0;
    char *payload = malloc(FS_BRIDGE_MAX + 4);
    while (out_fd >= 0 || request_fd >= 0)
    {
        int64_t remaining = deadline - now_ms();
        if (remaining <= 0) { timed_out = 1; break; }
        struct pollfd fds[2];
        int count = 0, out_index = -1, request_index = -1;
        if (out_fd >= 0) { fds[count] = (struct pollfd){out_fd, POLLIN, 0}; out_index = count++; }
        if (request_fd >= 0) { fds[count] = (struct pollfd){request_fd, POLLIN, 0}; request_index = count++; }
        int ready = poll(fds, (nfds_t)count, (int)remaining);
        if (ready < 0 && errno == EINTR) continue;
        if (ready < 0) break;
        if (out_index >= 0 && fds[out_index].revents)
        {
            char buffer[8192];
            ssize_t n = read(out_fd, buffer, sizeof(buffer));
            if (n > 0) append_output(buffer, (size_t)n);
            else if (n == 0 || errno != EINTR) { close(out_fd); out_fd = -1; }
        }
        if (request_index >= 0 && fds[request_index].revents)
        {
            char header[9];
            size_t length = 0;
            int good = read_exact_deadline(request_fd, header, 9, deadline) && header[0] == 'Q';
            if (good)
            {
                for (int i = 1; i < 9 && good; i++)
                {
                    char c = header[i];
                    int v = c >= '0' && c <= '9' ? c - '0' : c >= 'a' && c <= 'f' ? c - 'a' + 10 : -1;
                    if (v < 0) good = 0; else length = length * 16 + (size_t)v;
                }
            }
            if (good && (length > FS_BRIDGE_MAX + 2 || !payload)) good = 0;
            if (good) good = read_exact_deadline(request_fd, payload, length, deadline);
            if (!good)
            {
                close(request_fd); request_fd = -1;
                continue;
            }
            int ok = 0;
            const char *reply = fs_bridge_dispatch('f', payload, length, &ok);
            if (!fs_bridge_reply(reply_fd, ok, reply)) { close(request_fd); request_fd = -1; }
        }
    }
    free(payload);
    if (timed_out) kill(-child, SIGKILL);
    if (out_fd >= 0) close(out_fd);
    if (request_fd >= 0) close(request_fd);
    close(reply_fd);
    int wait_status = 0;
    while (waitpid(child, &wait_status, 0) < 0 && errno == EINTR) {}
    remove_run_dir(dir);
    int exit_code = WIFEXITED(wait_status) ? WEXITSTATUS(wait_status) : -1;
    tidy_output(!timed_out && exit_code == 0);
    if (timed_out)
    {
        append_output("\nFlow compilation or execution stopped after 60 seconds.", 57);
        flow_status = 504;
    }
    else if (exit_code == 127 && strstr(flow_output, "flow was not found"))
        flow_status = 503;
    else if (exit_code != 0)
    {
        const char *note = "\nProcess exited unsuccessfully.";
        append_output(note, strlen(note));
        flow_status = 422;
    }
    else flow_status = 200;
    if (flow_used == 0) append_output("(No output)", 11);
    return flow_output;
}

/* `flow run` wraps the program's output in a build log. A clean run keeps
 * only what the program printed; a failed one keeps the log without colour
 * codes or compiler-cache notes so the errors read plainly. */
static void tidy_output(int succeeded)
{
    const char *marker = "----------------------------------------\n";
    char *first = strstr(flow_output, marker);
    char *last = NULL;
    for (char *at = first; at; at = strstr(at + 1, marker)) last = at;
    if (succeeded && first && last && last > first)
    {
        /* Keep compiler warnings from the log, then the program output. */
        char *kept = malloc(flow_used + 1);
        if (!kept) return;
        size_t used = 0;
        for (char *line = flow_output; line < first;)
        {
            char *end = strchr(line, '\n');
            size_t length = end ? (size_t)(end - line + 1) : strlen(line);
            if (strstr(line, "warning") && (size_t)(strstr(line, "warning") - line) < length)
            {
                memcpy(kept + used, line, length);
                used += length;
            }
            line += length;
        }
        char *start = first + strlen(marker);
        size_t length = (size_t)(last - start);
        memcpy(kept + used, start, length);
        used += length;
        memcpy(flow_output, kept, used);
        free(kept);
        flow_used = used;
        flow_output[flow_used] = 0;
        return;
    }
    size_t out = 0;
    char *line = flow_output;
    while (*line)
    {
        char *end = strchr(line, '\n');
        size_t length = end ? (size_t)(end - line + 1) : strlen(line);
        int skip = strncmp(line, "ensure_flowc:", 13) == 0 || strncmp(line, marker, 40) == 0 ||
                   strstr(line, "\xe2\x84\xb9") == line + 7 || strstr(line, "\xe2\x9c\x85") == line + 7;
        for (size_t i = 0; i < length && !skip; i++)
        {
            if (line[i] == 27)   /* drop ESC [ ... m colour sequences */
            {
                while (i < length && line[i] != 'm') i++;
                continue;
            }
            flow_output[out++] = line[i];
        }
        line += length;
    }
    flow_output[out] = 0;
    flow_used = out;
}

int fs_flow_bridged_status(void) { return flow_status; }
