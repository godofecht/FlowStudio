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
 *
 * POST /api/app/start returns at once and the build runs in a child
 * process, so the IDE stays responsive while emcc works. GET
 * /flowapp/<build>/status reports its stage ("check", then "wasm") and,
 * at the end, the result. POST /api/app/build waits for the result.
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

static int write_file(const char *dir, const char *name, const char *text)
{
    char path[1024], temp[1100];
    snprintf(path, sizeof(path), "%s/%s", dir, name);
    snprintf(temp, sizeof(temp), "%s.tmp", path);
    FILE *file = fopen(temp, "wb");
    if (!file) return 0;
    int ok = fputs(text, file) >= 0;
    if (fclose(file) != 0) ok = 0;
    if (ok && rename(temp, path) != 0) ok = 0;
    if (!ok) unlink(temp);
    return ok;
}

/* Reads a small text file into a new string, or returns NULL. */
static char *read_file(const char *dir, const char *name, size_t limit)
{
    char path[1024];
    snprintf(path, sizeof(path), "%s/%s", dir, name);
    int fd = open(path, O_RDONLY);
    if (fd < 0) return NULL;
    struct stat info;
    if (fstat(fd, &info) != 0 || !S_ISREG(info.st_mode) || (size_t)info.st_size > limit)
    {
        close(fd);
        return NULL;
    }
    size_t size = (size_t)info.st_size, got = 0;
    char *data = malloc(size + 1);
    while (data && got < size)
    {
        ssize_t n = read(fd, data + got, size - got);
        if (n < 0 && errno == EINTR) continue;
        if (n <= 0) break;
        got += (size_t)n;
    }
    close(fd);
    if (data) data[got] = 0;
    return data;
}

/* Emscripten keeps the system libraries it builds (libc and friends) in a
 * cache. The shared cache is cleared whenever emcc runs with a different
 * configuration, for example a plain `emcc` whose config names another
 * LLVM, and then the next Preview build spends 15 to 20 seconds rebuilding
 * it. FlowStudio gives `flow wasm` a cache of its own that only it uses, so
 * the cost is paid once per machine. FLOWSTUDIO_EM_CACHE or EM_CACHE
 * choose another folder. */
static char em_cache[512];

static int make_dirs(char *path)
{
    for (char *at = path + 1; *at; at++)
    {
        if (*at != '/') continue;
        *at = 0;
        int ok = mkdir(path, 0700) == 0 || errno == EEXIST;
        *at = '/';
        if (!ok) return 0;
    }
    return mkdir(path, 0700) == 0 || errno == EEXIST;
}

static const char *ensure_cache(void)
{
    if (em_cache[0]) return em_cache;
    const char *chosen = getenv("FLOWSTUDIO_EM_CACHE");
    if (!chosen || !*chosen) chosen = getenv("EM_CACHE");
    if (chosen && *chosen) snprintf(em_cache, sizeof(em_cache), "%s", chosen);
    else
    {
        const char *xdg = getenv("XDG_CACHE_HOME"), *home = getenv("HOME");
        if (xdg && *xdg) snprintf(em_cache, sizeof(em_cache), "%s/flowstudio/emscripten", xdg);
        else if (home && *home) snprintf(em_cache, sizeof(em_cache), "%s/.cache/flowstudio/emscripten", home);
        else return NULL;
    }
    if (!make_dirs(em_cache)) { em_cache[0] = 0; return NULL; }
    return em_cache;
}

#define FS_APP_WARM_MARK ".flowstudio-warm"

/* True until one Preview build has finished with this cache. */
static int cache_cold(void)
{
    const char *cache = ensure_cache();
    return cache ? !file_exists(cache, FS_APP_WARM_MARK) : 0;
}

/* One build per slot, by build number. A build runs in a child process so
 * the server keeps answering while emcc works. */
#define FS_APP_SLOTS 8
struct app_job
{
    int build;
    pid_t pid;          /* 0 once the builder has been reaped */
    int64_t started;
    uint64_t hash;
    int cold;
};
static struct app_job app_jobs[FS_APP_SLOTS];

static uint64_t source_hash(const char *text)
{
    uint64_t hash = 1469598103934665603ULL;
    for (const unsigned char *c = (const unsigned char *)text; *c; c++) hash = (hash ^ *c) * 1099511628211ULL;
    return hash;
}

static struct app_job *job_for(int build)
{
    if (build <= 0) return NULL;
    struct app_job *job = &app_jobs[build % FS_APP_SLOTS];
    return job->build == build ? job : NULL;
}

static void build_dir(int build, char *out, size_t cap)
{
    snprintf(out, cap, "%s/%d", app_base, build);
}

static void reap(struct app_job *job)
{
    if (!job || job->pid <= 0) return;
    int status = 0;
    pid_t done = waitpid(job->pid, &status, WNOHANG);
    if (done == job->pid || (done < 0 && errno == ECHILD)) job->pid = 0;
}

static char *result_json(int ok, int build, int64_t ms, int gfx, int cold, const char *log)
{
    size_t cap = strlen(log) * 6 + 256;
    char *json = malloc(cap);
    if (!json) return NULL;
    size_t used = (size_t)snprintf(json, cap,
        "{\"ok\":%s,\"state\":\"%s\",\"build\":%d,\"ms\":%lld,\"gfx\":%s,\"cold\":%s,\"log\":",
        ok ? "true" : "false", ok ? "done" : "failed", build, (long long)ms,
        gfx ? "true" : "false", cold ? "true" : "false");
    json_string(json, cap, &used, log);
    if (used + 2 < cap) { json[used++] = '}'; json[used] = 0; }
    return json;
}

/* The builder: runs in the child, writes `stage` as it goes and
 * `result.json` at the end, then exits. */
static void run_builder(const char *dir, int build, int cold)
{
    for (int fd = 3; fd < 1024; fd++) close(fd);
    const char *cache = ensure_cache();
    if (cache) setenv("EM_CACHE", cache, 1);
    char *log = calloc(1, FS_APP_LOG_MAX);
    if (!log) _exit(1);
    int64_t started = now_ms();
    write_file(dir, "stage", "check");
    char *check[] = { "flow", "tool", "compiler/scripts/flowc_emit.flow", "--strict", "app.flow", "check.c", NULL };
    int code_check = run_captured(dir, check, log, FS_APP_LOG_MAX, FS_APP_CHECK_MS);
    int ok = code_check == 0;
    int gfx = 0;
    if (ok)
    {
        log[0] = 0;
        write_file(dir, "stage", "wasm");
        /* -O1 links about a third faster than the default -O2, and the
         * Preview rebuilds on every save. */
        char *wasm[] = { "flow", "wasm", "app.flow", "--out", "out", "-O1", NULL };
        int code_wasm = run_captured(dir, wasm, log, FS_APP_LOG_MAX, FS_APP_BUILD_MS);
        ok = code_wasm == 0 && file_exists(dir, "out/app.js") && file_exists(dir, "out/app.wasm");
        gfx = strstr(log, "gfx canvas") != NULL;
        if (code_wasm == -2) strncat(log, "\nThe WebAssembly build stopped after 3 minutes.", FS_APP_LOG_MAX - strlen(log) - 1);
        if (ok) log[0] = 0;   /* a clean build has nothing worth showing */
        if (ok && cache) write_file(cache, FS_APP_WARM_MARK, "1\n");
    }
    else if (code_check == -2)
        strncat(log, "\nThe type check stopped after 30 seconds.", FS_APP_LOG_MAX - strlen(log) - 1);
    else if (code_check == 127)
        write_file(dir, "missing", "flow\n");
    tidy_log(log, dir);
    char *json = result_json(ok, build, now_ms() - started, gfx, cold, log);
    if (json) write_file(dir, "result.json", json);
    _exit(0);
}

static char app_reply[256];

static const char *fail_reply(const char *message)
{
    app_status = 500;
    snprintf(app_reply, sizeof(app_reply), "{\"ok\":false,\"state\":\"failed\",\"log\":\"%s\"}", message);
    return app_reply;
}

/* Status of a build as JSON: the result once the builder has written it,
 * otherwise the stage and how long it has run. */
static int app_last = 0;     /* the build the last reply was about */

static const char *job_status(int build)
{
    app_last = build;
    free(app_json);
    app_json = NULL;
    char dir[640];
    build_dir(build, dir, sizeof(dir));
    struct app_job *job = job_for(build);
    reap(job);
    char *result = read_file(dir, "result.json", FS_APP_LOG_MAX * 6 + 512);
    if (result)
    {
        app_json = result;
        app_status = strstr(result, "\"ok\":true") ? 200 : 422;
        if (file_exists(dir, "missing")) app_status = 503;
        return app_json;
    }
    if (!job || job->pid == 0)
    {
        app_status = 500;
        snprintf(app_reply, sizeof(app_reply),
                 "{\"ok\":false,\"state\":\"failed\",\"build\":%d,\"log\":\"The build stopped before it finished.\"}", build);
        return app_reply;
    }
    char *stage = read_file(dir, "stage", 32);
    const char *name = stage && !strncmp(stage, "wasm", 4) ? "wasm" : "check";
    snprintf(app_reply, sizeof(app_reply), "{\"state\":\"%s\",\"build\":%d,\"elapsed\":%lld,\"cold\":%s}",
             name, build, (long long)(now_ms() - job->started), job->cold ? "true" : "false");
    free(stage);
    app_status = 202;
    return app_reply;
}

/* Starts a build of code as app.flow and returns at once with
 *   {"state":"check","build":7,"elapsed":0,"cold":false}
 * GET /flowapp/<build>/status follows it. The same source as a build that
 * is still running, or one that succeeded and is still kept, returns that
 * build instead of starting another. */
const char *fs_app_start(const char *code)
{
    if (!ensure_base()) return fail_reply("FlowStudio could not create its private app build folder.");
    for (int i = 0; i < FS_APP_SLOTS; i++) reap(&app_jobs[i]);
    uint64_t hash = source_hash(code);
    for (int i = 0; i < FS_APP_SLOTS; i++)
    {
        struct app_job *job = &app_jobs[i];
        if (job->build <= 0 || job->hash != hash || job->build <= app_build - FS_APP_KEEP) continue;
        reap(job);
        char dir[640];
        build_dir(job->build, dir, sizeof(dir));
        char *result = read_file(dir, "result.json", FS_APP_LOG_MAX * 6 + 512);
        int good = result && strstr(result, "\"ok\":true") != NULL;
        free(result);
        if (job->pid > 0 || good) return job_status(job->build);
    }
    int build = ++app_build;
    char dir[640];
    build_dir(build, dir, sizeof(dir));
    remove_tree(dir);
    if (mkdir(dir, 0700) != 0) return fail_reply("FlowStudio could not create a build folder.");
    if (build > FS_APP_KEEP)
    {
        char old[640];
        build_dir(build - FS_APP_KEEP, old, sizeof(old));
        remove_tree(old);
    }
    if (!write_file(dir, "app.flow", code)) return fail_reply("FlowStudio could not write the app source.");
    struct app_job *job = &app_jobs[build % FS_APP_SLOTS];
    reap(job);
    job->build = build;
    job->hash = hash;
    job->started = now_ms();
    job->cold = cache_cold();
    pid_t child = fork();
    if (child < 0) { job->pid = 0; return fail_reply("FlowStudio could not start the build."); }
    if (child == 0) run_builder(dir, build, job->cold);
    job->pid = child;
    return job_status(build);
}

/* Builds code as app.flow and waits for it. Returns JSON:
 *   {"ok":true,"state":"done","build":7,"ms":930,"gfx":true,"cold":false,"log":""}
 * The HTTP status is available from fs_app_build_status. */
const char *fs_app_build(const char *code)
{
    const char *started = fs_app_start(code);
    if (app_status != 202) return started;
    struct app_job *job = job_for(app_last);
    if (!job) return started;
    if (job->pid > 0)
    {
        int status = 0;
        while (waitpid(job->pid, &status, 0) < 0 && errno == EINTR) {}
        job->pid = 0;
    }
    return job_status(job->build);
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
    if (!strcmp(at, "status"))
    {
        /* Always 200: the JSON carries the outcome, and a failed build is
         * not a failed request. */
        fs_reply(200, "application/json; charset=utf-8", job_status((int)build));
        return 1;
    }
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
