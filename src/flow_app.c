/* Flow apps in the browser.
 *
 * A Flow program that draws with stdlib/gfx.flow is type checked with the
 * strict emitter, then built by `flow wasm` into WebAssembly with the canvas
 * backend (runtime/gfx_wasm.c in the Flow repository). The IDE loads the
 * result in its Preview panel and rebuilds it as the source changes.
 *
 * Builds live in a private per-user directory under the system temp folder,
 * one numbered folder per build. Only the last few builds are kept. GET
 * /flowapp/<build>/<file> serves a fixed set of file names from a build; the
 * URL is never used as a path on its own.
 */
#ifndef _POSIX_C_SOURCE
#define _POSIX_C_SOURCE 200809L
#endif
#ifndef _XOPEN_SOURCE
#define _XOPEN_SOURCE 700
#endif
#ifndef _DEFAULT_SOURCE
#define _DEFAULT_SOURCE
#endif
#if defined(__APPLE__) && !defined(_DARWIN_C_SOURCE)
#define _DARWIN_C_SOURCE
#endif
#include <dirent.h>
#include <limits.h>
#ifndef PATH_MAX
#define PATH_MAX 4096
#endif
#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

#define FS_APP_KEEP 4
#define FS_APP_LOG_MAX 65536
#define FS_APP_FILE_MAX (32 * 1024 * 1024)
#define FS_APP_CHECK_MS 30000
#define FS_APP_BUILD_MS 180000

void fs_reply(int code, const char *content_type, const char *body);
void fs_reply_bytes(int code, const char *content_type, const char *body, size_t length);

static char app_base[512];
static int app_build = 0;
static int app_status = 503;
static char *app_json = NULL;

static int64_t now_ms(void)
{
    struct timespec t;
    if (clock_gettime(CLOCK_MONOTONIC, &t) != 0) return 0;
    return (int64_t)t.tv_sec * 1000 + t.tv_nsec / 1000000;
}

static int ensure_base(void)
{
    if (app_base[0]) return 1;
    const char *tmp = getenv("TMPDIR");
    if (!tmp || !*tmp) tmp = "/tmp";
    char path[512];
    snprintf(path, sizeof(path), "%s/flowstudio-apps-%ld", tmp, (long)getuid());
    if (mkdir(path, 0700) != 0 && errno != EEXIST) return 0;
    struct stat info;
    /* Refuse a directory someone else owns or can write to. */
    if (lstat(path, &info) != 0 || !S_ISDIR(info.st_mode) || info.st_uid != getuid() ||
        (info.st_mode & 0077) != 0) return 0;
    /* Compiler messages name the resolved path (macOS /var is /private/var). */
    char resolved[PATH_MAX];
    snprintf(app_base, sizeof(app_base), "%s", realpath(path, resolved) ? resolved : path);
    return 1;
}

static void remove_tree(const char *path)
{
    DIR *dir = opendir(path);
    if (dir)
    {
        struct dirent *entry;
        while ((entry = readdir(dir)) != NULL)
        {
            if (!strcmp(entry->d_name, ".") || !strcmp(entry->d_name, "..")) continue;
            char child[1024];
            snprintf(child, sizeof(child), "%s/%s", path, entry->d_name);
            struct stat info;
            if (lstat(child, &info) == 0 && S_ISDIR(info.st_mode)) remove_tree(child);
            else unlink(child);
        }
        closedir(dir);
    }
    rmdir(path);
}

/* Runs argv in dir with stdout and stderr captured into log. Returns the
 * exit code, -2 on timeout, -1 if the process could not start. */
static int run_captured(const char *dir, char *const argv[], char *log, size_t cap, int64_t limit_ms)
{
    int out[2];
    if (pipe(out) != 0) return -1;
    pid_t child = fork();
    if (child < 0) { close(out[0]); close(out[1]); return -1; }
    if (child == 0)
    {
        (void)setpgid(0, 0);
        int devnull = open("/dev/null", O_RDONLY);
        if (devnull < 0 || chdir(dir) != 0) _exit(127);
        if (dup2(devnull, STDIN_FILENO) < 0 || dup2(out[1], STDOUT_FILENO) < 0 ||
            dup2(out[1], STDERR_FILENO) < 0) _exit(127);
        for (int fd = 3; fd < 1024; fd++) close(fd);
        execvp(argv[0], argv);
        const char *message = "flow was not found on PATH.\n";
        (void)!write(STDOUT_FILENO, message, strlen(message));
        _exit(127);
    }
    (void)setpgid(child, child);
    close(out[1]);
    size_t used = strlen(log);
    int64_t deadline = now_ms() + limit_ms;
    int timed_out = 0;
    for (;;)
    {
        int64_t remaining = deadline - now_ms();
        if (remaining <= 0) { timed_out = 1; break; }
        struct pollfd fd = { out[0], POLLIN, 0 };
        int ready = poll(&fd, 1, (int)remaining);
        if (ready < 0 && errno == EINTR) continue;
        if (ready <= 0) { timed_out = ready == 0; break; }
        char buffer[4096];
        ssize_t n = read(out[0], buffer, sizeof(buffer));
        if (n < 0 && errno == EINTR) continue;
        if (n <= 0) break;
        size_t take = (size_t)n;
        if (used + take > cap - 1) take = cap - 1 - used;
        memcpy(log + used, buffer, take);
        used += take;
        log[used] = 0;
    }
    close(out[0]);
    if (timed_out) kill(-child, SIGKILL);
    int status = 0;
    while (waitpid(child, &status, 0) < 0 && errno == EINTR) {}
    if (timed_out) return -2;
    return WIFEXITED(status) ? WEXITSTATUS(status) : -1;
}

/* Drops colour codes, progress notes and compiler-cache lines, and shortens
 * the build folder in paths to the file name the editor shows. */
static void tidy_log(char *log, const char *dir)
{
    size_t dir_len = strlen(dir);
    char *read = log, *write = log;
    while (*read)
    {
        char *end = strchr(read, '\n');
        size_t length = end ? (size_t)(end - read + 1) : strlen(read);
        int skip = strncmp(read, "ensure_flowc:", 13) == 0 ||
                   strncmp(read, "flowc emit: ", 12) == 0 ||
                   (length > 7 && read[0] == 27 && (strstr(read, "\xe2\x84\xb9") == read + 7 ||
                                                    strstr(read, "\xe2\x9c\x85") == read + 7));
        if (!skip)
        {
            for (size_t i = 0; i < length; i++)
            {
                if (read[i] == 27) { while (i < length && read[i] != 'm') i++; continue; }
                if (i + dir_len + 1 <= length && strncmp(read + i, dir, dir_len) == 0 && read[i + dir_len] == '/')
                {
                    i += dir_len;   /* the following '/' is skipped by the loop */
                    continue;
                }
                *write++ = read[i];
            }
        }
        read += length;
    }
    *write = 0;
}

static void json_string(char *out, size_t cap, size_t *used, const char *text)
{
    if (*used + 2 >= cap) return;
    out[(*used)++] = '"';
    for (const unsigned char *c = (const unsigned char *)text; *c && *used + 8 < cap; c++)
    {
        if (*c == '"' || *c == '\\') { out[(*used)++] = '\\'; out[(*used)++] = (char)*c; }
        else if (*c == '\n') { out[(*used)++] = '\\'; out[(*used)++] = 'n'; }
        else if (*c == '\t') { out[(*used)++] = '\\'; out[(*used)++] = 't'; }
        else if (*c < 0x20) *used += (size_t)snprintf(out + *used, cap - *used, "\\u%04x", *c);
        else out[(*used)++] = (char)*c;
    }
    out[(*used)++] = '"';
    out[*used] = 0;
}

static int file_exists(const char *dir, const char *name)
{
    char path[1024];
    snprintf(path, sizeof(path), "%s/%s", dir, name);
    struct stat info;
    return stat(path, &info) == 0 && S_ISREG(info.st_mode);
}

/* Builds code as app.flow. Returns JSON:
 *   {"ok":true,"build":7,"ms":930,"gfx":true,"log":"..."}
 * The HTTP status is available from fs_app_build_status. */
const char *fs_app_build(const char *code)
{
    free(app_json);
    app_json = NULL;
    app_status = 500;
    static char fallback[160];
    if (!ensure_base())
    {
        snprintf(fallback, sizeof(fallback), "{\"ok\":false,\"log\":\"FlowStudio could not create its private app build folder.\"}");
        return fallback;
    }
    int build = ++app_build;
    char dir[640];
    snprintf(dir, sizeof(dir), "%s/%d", app_base, build);
    remove_tree(dir);
    if (mkdir(dir, 0700) != 0)
    {
        snprintf(fallback, sizeof(fallback), "{\"ok\":false,\"log\":\"FlowStudio could not create a build folder.\"}");
        return fallback;
    }
    if (build > FS_APP_KEEP)
    {
        char old[640];
        snprintf(old, sizeof(old), "%s/%d", app_base, build - FS_APP_KEEP);
        remove_tree(old);
    }
    char source[700];
    snprintf(source, sizeof(source), "%s/app.flow", dir);
    FILE *file = fopen(source, "wb");
    if (!file || fputs(code, file) < 0 || fclose(file) != 0)
    {
        snprintf(fallback, sizeof(fallback), "{\"ok\":false,\"log\":\"FlowStudio could not write the app source.\"}");
        return fallback;
    }

    char *log = calloc(1, FS_APP_LOG_MAX);
    if (!log) return "{\"ok\":false,\"log\":\"Out of memory.\"}";
    int64_t started = now_ms();
    char *check[] = { "flow", "tool", "compiler/scripts/flowc_emit.flow", "--strict", "app.flow", "check.c", NULL };
    int code_check = run_captured(dir, check, log, FS_APP_LOG_MAX, FS_APP_CHECK_MS);
    int ok = code_check == 0;
    int gfx = 0;
    if (ok)
    {
        log[0] = 0;
        char *wasm[] = { "flow", "wasm", "app.flow", "--out", "out", NULL };
        int code_wasm = run_captured(dir, wasm, log, FS_APP_LOG_MAX, FS_APP_BUILD_MS);
        ok = code_wasm == 0 && file_exists(dir, "out/app.js") && file_exists(dir, "out/app.wasm");
        gfx = strstr(log, "gfx canvas") != NULL;
        if (code_wasm == -2) strncat(log, "\nThe WebAssembly build stopped after 3 minutes.", FS_APP_LOG_MAX - strlen(log) - 1);
        if (ok) log[0] = 0;   /* a clean build has nothing worth showing */
    }
    else if (code_check == -2)
        strncat(log, "\nThe type check stopped after 30 seconds.", FS_APP_LOG_MAX - strlen(log) - 1);
    int64_t elapsed = now_ms() - started;
    tidy_log(log, dir);

    size_t cap = FS_APP_LOG_MAX * 2 + 256;
    app_json = malloc(cap);
    if (!app_json) { free(log); return "{\"ok\":false,\"log\":\"Out of memory.\"}"; }
    size_t used = (size_t)snprintf(app_json, cap, "{\"ok\":%s,\"build\":%d,\"ms\":%lld,\"gfx\":%s,\"log\":",
        ok ? "true" : "false", build, (long long)elapsed, gfx ? "true" : "false");
    json_string(app_json, cap, &used, log);
    if (used + 2 < cap) { app_json[used++] = '}'; app_json[used] = 0; }
    free(log);
    app_status = ok ? 200 : 422;
    if (code_check == 127) app_status = 503;
    return app_json;
}

int fs_app_build_status(void) { return app_status; }

/* Serves GET /flowapp/<build>/<file>. Returns 1 when the path was an app path
 * (and a reply was sent), 0 otherwise. */
int fs_app_serve(const char *path)
{
    if (strncmp(path, "/flowapp/", 9) != 0) return 0;
    const char *at = path + 9;
    long build = 0;
    int digits = 0;
    while (*at >= '0' && *at <= '9' && digits < 9) { build = build * 10 + (*at - '0'); at++; digits++; }
    if (!digits || *at != '/' || build <= 0 || build > app_build || build <= app_build - FS_APP_KEEP || !ensure_base())
    {
        fs_reply(404, "text/plain; charset=utf-8", "That app build is gone. Run the app again.");
        return 1;
    }
    at++;
    const char *type = NULL;
    if (!strcmp(at, "app.js")) type = "text/javascript; charset=utf-8";
    else if (!strcmp(at, "app.wasm")) type = "application/wasm";
    else if (!strcmp(at, "app.data")) type = "application/octet-stream";
    if (!type)
    {
        fs_reply(404, "text/plain; charset=utf-8", "Unknown app file.");
        return 1;
    }
    char file_path[1024];
    snprintf(file_path, sizeof(file_path), "%s/%ld/out/%s", app_base, build, at);
    int fd = open(file_path, O_RDONLY);
    struct stat info;
    if (fd < 0 || fstat(fd, &info) != 0 || !S_ISREG(info.st_mode) || info.st_size > FS_APP_FILE_MAX)
    {
        if (fd >= 0) close(fd);
        fs_reply(404, "text/plain; charset=utf-8", "App file not found.");
        return 1;
    }
    size_t size = (size_t)info.st_size;
    char *data = malloc(size + 1);
    size_t got = 0;
    while (data && got < size)
    {
        ssize_t n = read(fd, data + got, size - got);
        if (n < 0 && errno == EINTR) continue;
        if (n <= 0) break;
        got += (size_t)n;
    }
    close(fd);
    if (!data || got != size)
    {
        free(data);
        fs_reply(500, "text/plain; charset=utf-8", "App file could not be read.");
        return 1;
    }
    fs_reply_bytes(200, type, data, size);
    free(data);
    return 1;
}
