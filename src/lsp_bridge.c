/*
 * FlowStudio bridge to Flow's language server (`flow lsp`).
 * Routes stay in Flow (src/main.flow) behind the intent and origin gate; this
 * file owns one persistent child and its Content-Length framed pipes.
 *
 *   request  body: one JSON-RPC message from the browser.
 *            A request gets the matching response with the caller's id put
 *            back. A notification is forwarded and answered with "null".
 *            initialize is answered from the handshake the bridge performed.
 *   events   body ignored. Returns and clears queued server notifications
 *            (publishDiagnostics and flowstudio/serverStarted) as a JSON array.
 *   status   body ignored. {"running", "pid", "generation", "queued"}.
 *
 * Workspace mirror. The browser holds project files (a folder handle or the
 * origin private file system), so `flow lsp` cannot read them. The browser
 * names documents file:///flowstudio/<project>/<path>. The bridge keeps a
 * private directory under $TMPDIR and maps that prefix to it both ways:
 * "uri" values in browser messages point into the directory, and the
 * directory's URI and path in server messages become the virtual prefix
 * again. The full text of every didOpen and didChange is written there
 * first, so the server reads unsaved buffers when it resolves an import.
 * The notification flowstudio/forget {uri} deletes a mirrored file, or a
 * folder when the uri ends in "/". A "uri" outside file:///flowstudio/ or
 * with an empty, "." or ".." segment is refused with 400.
 *
 * The HTTP loop is single-threaded, so every wait is bounded: 3 seconds per
 * request, 10 seconds for the startup handshake. A child that exits is
 * started again on the next request, and the browser learns of it through a
 * flowstudio/serverStarted event so it can reopen its documents.
 * fs_lsp_status() reports 200, 400, 503 (no server) or 504 (timeout).
 */
#ifndef _POSIX_C_SOURCE
#define _POSIX_C_SOURCE 200809L
#endif
#if defined(__APPLE__) && !defined(_DARWIN_C_SOURCE)
#define _DARWIN_C_SOURCE                   /* mkdtemp and O_NOFOLLOW */
#endif
#if !defined(__APPLE__) && !defined(_XOPEN_SOURCE)
#define _XOPEN_SOURCE 700                  /* realpath */
#endif
#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <dirent.h>
#include <limits.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

#ifndef PATH_MAX
#define PATH_MAX 4096
#endif

enum {
    LSP_MESSAGE_MAX = 2 * 1024 * 1024,     /* larger server messages are skipped */
    LSP_HEADER_MAX = 8192,
    LSP_QUEUE_MAX = 64,                    /* queued notifications */
    LSP_QUEUE_BYTES = 4 * 1024 * 1024,     /* and their total size */
    LSP_REQUEST_MS = 3000,
    LSP_START_MS = 10000,
    LSP_RETRY_MS = 10000                   /* after a failed start, wait this long */
};

static pid_t child = -1;
static int to_child = -1;
static int from_child = -1;
static int generation = 0;
static int lsp_last_status = 503;
static int64_t failed_at = -1;

static char *inbuf;                        /* bytes read from the child, not yet framed */
static size_t inlen;
static size_t discard_left;                /* bytes of an oversized message still to drop */

static char *queue[LSP_QUEUE_MAX];
static int queue_len;
static size_t queue_bytes;

static char *capabilities;                 /* "result" of the bridge's initialize */
static char *reply;                        /* last reply handed to Flow */
static long next_id = 1;
static long waiting_id = -1;               /* bridge id whose response is wanted */
static char *waiting_response;
static char *forwarded;                    /* browser message after URI mapping */

int fs_lsp_status(void) { return lsp_last_status; }

static int64_t now_ms(void)
{
    struct timespec t;
    clock_gettime(CLOCK_MONOTONIC, &t);
    return (int64_t)t.tv_sec * 1000 + t.tv_nsec / 1000000;
}

static const char *set_reply(int status, char *owned)
{
    free(reply);
    reply = owned;
    lsp_last_status = status;
    return reply ? reply : "";
}

static const char *fail(int status, const char *message)
{
    return set_reply(status, strdup(message));
}

/* ---- Minimal JSON scanning: top-level members of one object ---- */

static const char *skip_ws(const char *p, const char *end)
{
    while (p < end && (*p == ' ' || *p == '\t' || *p == '\r' || *p == '\n')) p++;
    return p;
}

static const char *skip_string(const char *p, const char *end)
{
    if (p >= end || *p != '"') return NULL;
    for (p++; p < end; p++) {
        if (*p == '\\') { p++; continue; }
        if (*p == '"') return p + 1;
    }
    return NULL;
}

static const char *skip_value(const char *p, const char *end)
{
    p = skip_ws(p, end);
    if (p >= end) return NULL;
    if (*p == '"') return skip_string(p, end);
    if (*p == '{' || *p == '[') {
        int depth = 0;
        while (p < end) {
            if (*p == '"') { p = skip_string(p, end); if (!p) return NULL; continue; }
            if (*p == '{' || *p == '[') depth++;
            else if (*p == '}' || *p == ']') { if (--depth == 0) return p + 1; }
            p++;
        }
        return NULL;
    }
    while (p < end && *p != ',' && *p != '}' && *p != ']' &&
           *p != ' ' && *p != '\t' && *p != '\r' && *p != '\n') p++;
    return p;
}

/* Find a top-level member. Sets the value span; returns 1 when found. */
static int json_member(const char *json, size_t length, const char *key,
                       const char **value, size_t *value_length)
{
    const char *end = json + length;
    const char *p = skip_ws(json, end);
    size_t key_length = strlen(key);
    if (p >= end || *p != '{') return 0;
    p++;
    for (;;) {
        p = skip_ws(p, end);
        if (p >= end || *p == '}') return 0;
        const char *k = p;
        p = skip_string(p, end);
        if (!p) return 0;
        int match = (size_t)(p - k) == key_length + 2 && memcmp(k + 1, key, key_length) == 0;
        p = skip_ws(p, end);
        if (p >= end || *p != ':') return 0;
        p = skip_ws(p + 1, end);
        const char *v = p;
        p = skip_value(p, end);
        if (!p) return 0;
        if (match) { *value = v; *value_length = (size_t)(p - v); return 1; }
        p = skip_ws(p, end);
        if (p < end && *p == ',') { p++; continue; }
        return 0;
    }
}

static int has_id(const char *json, size_t length, const char **value, size_t *value_length)
{
    const char *v = NULL;
    size_t n = 0;
    if (!json_member(json, length, "id", &v, &n)) return 0;
    if (n == 4 && memcmp(v, "null", 4) == 0) return 0;
    if (value) { *value = v; *value_length = n; }
    return 1;
}

static int method_is(const char *json, size_t length, const char *method)
{
    const char *v = NULL;
    size_t n = 0;
    size_t m = strlen(method);
    return json_member(json, length, "method", &v, &n) && n == m + 2 && memcmp(v + 1, method, m) == 0;
}

/* Copy json with the span [at, at + old) replaced by text. */
static char *splice(const char *json, size_t length, const char *at, size_t old, const char *text, size_t text_length)
{
    size_t head = (size_t)(at - json);
    size_t total = length - old + text_length;
    char *out = malloc(total + 1);
    if (!out) return NULL;
    memcpy(out, json, head);
    memcpy(out + head, text, text_length);
    memcpy(out + head + text_length, at + old, length - head - old);
    out[total] = 0;
    return out;
}

/* ---- Workspace mirror ---- */

static const char VIRTUAL_ROOT[] = "file:///flowstudio/";
static char *mirror;                       /* real path of the private directory */
static char *mirror_uri;                   /* its file:// form, as flow lsp writes it */
static int mirror_failed;

/* A growable byte buffer. */
typedef struct { char *data; size_t length, room; int failed; } Buf;

static void buf_put(Buf *b, const char *bytes, size_t n)
{
    if (b->failed) return;
    if (b->length + n + 1 > b->room) {
        size_t room = b->room ? b->room : 256;
        while (b->length + n + 1 > room) room *= 2;
        char *grown = realloc(b->data, room);
        if (!grown) { b->failed = 1; return; }
        b->data = grown;
        b->room = room;
    }
    memcpy(b->data + b->length, bytes, n);
    b->length += n;
    b->data[b->length] = 0;
}

static void buf_str(Buf *b, const char *text) { buf_put(b, text, strlen(text)); }

static char *buf_take(Buf *b)
{
    if (b->failed) { free(b->data); b->data = NULL; return NULL; }
    if (!b->data) return strdup("");
    return b->data;
}

static int hex_value(int c)
{
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

static int hex4(const char *p, unsigned *code)
{
    *code = 0;
    for (int i = 0; i < 4; i++) {
        int h = hex_value((unsigned char)p[i]);
        if (h < 0) return 0;
        *code = *code * 16 + (unsigned)h;
    }
    return 1;
}

/* The JSON string at [p, end), quotes included, decoded to UTF-8. NULL when
 * it is malformed or holds a NUL character. */
static char *json_string(const char *p, const char *end, size_t *out_length)
{
    if (end - p < 2 || *p != '"' || end[-1] != '"') return NULL;
    Buf b = {0};
    for (p++, end--; p < end; p++) {
        if (*p != '\\') { buf_put(&b, p, 1); continue; }
        if (++p >= end) { free(b.data); return NULL; }
        if (*p != 'u') {
            char c = *p == 'n' ? '\n' : *p == 't' ? '\t' : *p == 'r' ? '\r' :
                     *p == 'b' ? '\b' : *p == 'f' ? '\f' : *p;
            buf_put(&b, &c, 1);
            continue;
        }
        unsigned code = 0, low = 0;
        if (end - p < 5 || !hex4(p + 1, &code)) { free(b.data); return NULL; }
        p += 4;
        if (code >= 0xD800 && code <= 0xDBFF && end - p >= 7 && p[1] == '\\' && p[2] == 'u' &&
            hex4(p + 3, &low) && low >= 0xDC00 && low <= 0xDFFF) {
            code = 0x10000 + ((code - 0xD800) << 10) + (low - 0xDC00);
            p += 6;
        }
        if (code == 0) { free(b.data); return NULL; }
        char u[4];
        size_t n;
        if (code < 0x80) { u[0] = (char)code; n = 1; }
        else if (code < 0x800) { u[0] = (char)(0xC0 | (code >> 6)); u[1] = (char)(0x80 | (code & 0x3F)); n = 2; }
        else if (code < 0x10000) {
            u[0] = (char)(0xE0 | (code >> 12)); u[1] = (char)(0x80 | ((code >> 6) & 0x3F));
            u[2] = (char)(0x80 | (code & 0x3F)); n = 3;
        } else {
            u[0] = (char)(0xF0 | (code >> 18)); u[1] = (char)(0x80 | ((code >> 12) & 0x3F));
            u[2] = (char)(0x80 | ((code >> 6) & 0x3F)); u[3] = (char)(0x80 | (code & 0x3F)); n = 4;
        }
        buf_put(&b, u, n);
    }
    size_t length = b.length;
    char *out = buf_take(&b);
    if (out && out_length) *out_length = length;
    return out;
}

static void json_put_string(Buf *b, const char *text)
{
    buf_put(b, "\"", 1);
    for (const unsigned char *p = (const unsigned char *)text; *p; p++) {
        if (*p == '"' || *p == '\\') { char e[2] = { '\\', (char)*p }; buf_put(b, e, 2); }
        else if (*p < 0x20) { char e[8]; snprintf(e, sizeof(e), "\\u%04x", *p); buf_str(b, e); }
        else buf_put(b, (const char *)p, 1);
    }
    buf_put(b, "\"", 1);
}

/* The path under the mirror that a virtual URI names, percent-decoded the
 * way flow lsp decodes it. NULL unless every segment is a plain name. With
 * folder_ok a trailing "/" names a folder and "" names the whole mirror. */
static char *virtual_path(const char *uri, int folder_ok)
{
    size_t root = sizeof(VIRTUAL_ROOT) - 1;
    if (strncmp(uri, VIRTUAL_ROOT, root) != 0) return NULL;
    const char *rest = uri + root;
    size_t n = strlen(rest);
    if (n > 2048) return NULL;
    char *path = malloc(n + 1);
    if (!path) return NULL;
    size_t at = 0;
    for (size_t i = 0; i < n; i++) {
        int hi = -1, lo = -1;
        if (rest[i] == '%' && i + 2 < n &&
            (hi = hex_value((unsigned char)rest[i + 1])) >= 0 && (lo = hex_value((unsigned char)rest[i + 2])) >= 0) {
            path[at++] = (char)(hi * 16 + lo);
            i += 2;
        } else path[at++] = rest[i];
    }
    path[at] = 0;
    if (strlen(path) != at) { free(path); return NULL; }     /* a %00 */
    size_t length = at;
    if (folder_ok && length > 0 && path[length - 1] == '/') length--;
    if (length == 0) {
        if (folder_ok) return path;
        free(path);
        return NULL;
    }
    for (size_t start = 0; start <= length; ) {
        size_t stop = start;
        while (stop < length && path[stop] != '/') stop++;
        size_t part = stop - start;
        if (part == 0 || (part == 1 && path[start] == '.') ||
            (part == 2 && path[start] == '.' && path[start + 1] == '.') ||
            memchr(path + start, '\\', part)) {
            free(path);
            return NULL;
        }
        start = stop + 1;
    }
    return path;
}

static void remove_tree(const char *path)
{
    struct stat info;
    if (lstat(path, &info) != 0) return;
    if (!S_ISDIR(info.st_mode)) { unlink(path); return; }
    DIR *dir = opendir(path);
    if (dir) {
        struct dirent *item;
        while ((item = readdir(dir)) != NULL) {
            if (strcmp(item->d_name, ".") == 0 || strcmp(item->d_name, "..") == 0) continue;
            size_t size = strlen(path) + strlen(item->d_name) + 2;
            char *inner = malloc(size);
            if (!inner) continue;
            snprintf(inner, size, "%s/%s", path, item->d_name);
            remove_tree(inner);
            free(inner);
        }
        closedir(dir);
    }
    rmdir(path);
}

static void remove_mirror(void)
{
    if (mirror) remove_tree(mirror);
}

/* Create the private directory once. Without it URIs pass through as before. */
static int ensure_mirror(void)
{
    if (mirror) return 1;
    if (mirror_failed) return 0;
    mirror_failed = 1;
    const char *tmp = getenv("TMPDIR");
    if (!tmp || !*tmp) tmp = "/tmp";
    size_t tmp_length = strlen(tmp);
    while (tmp_length > 1 && tmp[tmp_length - 1] == '/') tmp_length--;
    char pattern[PATH_MAX];
    int n = snprintf(pattern, sizeof(pattern), "%.*s/flowstudio-lsp-XXXXXX", (int)tmp_length, tmp);
    if (n < 0 || n >= (int)sizeof(pattern) || !mkdtemp(pattern)) return 0;
    char *real = realpath(pattern, NULL);
    if (!real) { rmdir(pattern); return 0; }
    /* flow lsp leaves only these bytes unescaped in the URIs it writes, so
     * any other byte would make its URIs differ from mirror_uri. */
    for (const char *p = real; *p; p++) {
        int c = (unsigned char)*p;
        if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') ||
              c == '_' || c == '.' || c == '~' || c == '/' || c == '-')) {
            rmdir(real);
            free(real);
            return 0;
        }
    }
    size_t size = strlen(real) + 8;
    mirror_uri = malloc(size);
    if (!mirror_uri) { rmdir(real); free(real); return 0; }
    snprintf(mirror_uri, size, "file://%s", real);
    mirror = real;
    mirror_failed = 0;
    atexit(remove_mirror);
    return 1;
}

static char *mirror_file(const char *relative)
{
    size_t size = strlen(mirror) + strlen(relative) + 2;
    char *full = malloc(size);
    if (full) snprintf(full, size, "%s/%s", mirror, relative);
    return full;
}

/* Write text to mirror/relative, creating folders. Never follows a link. */
static int mirror_write(const char *relative, const char *text, size_t length)
{
    char *full = mirror_file(relative);
    if (!full) return 0;
    for (char *slash = strchr(full + strlen(mirror) + 1, '/'); slash; slash = strchr(slash + 1, '/')) {
        *slash = 0;
        struct stat info;
        if ((mkdir(full, 0700) != 0 && errno != EEXIST) || lstat(full, &info) != 0 || !S_ISDIR(info.st_mode)) {
            free(full);
            return 0;
        }
        *slash = '/';
    }
    int fd = open(full, O_WRONLY | O_CREAT | O_TRUNC | O_NOFOLLOW | O_CLOEXEC, 0600);
    free(full);
    if (fd < 0) return 0;
    size_t done = 0;
    while (done < length) {
        ssize_t put = write(fd, text + done, length - done);
        if (put < 0 && errno == EINTR) continue;
        if (put <= 0) break;
        done += (size_t)put;
    }
    close(fd);
    return done == length;
}

/* The decoded string value of member key of an object. */
static char *member_string(const char *json, size_t length, const char *key, size_t *out_length)
{
    const char *v = NULL;
    size_t n = 0;
    if (!json || !json_member(json, length, key, &v, &n) || *v != '"') return NULL;
    return json_string(v, v + n, out_length);
}

/* Write the full text of a didOpen or didChange before the server reads it. */
static void mirror_document(const char *body, size_t length)
{
    int opening = method_is(body, length, "textDocument/didOpen");
    if (!mirror || (!opening && !method_is(body, length, "textDocument/didChange"))) return;
    const char *params = NULL, *document = NULL;
    size_t params_length = 0, document_length = 0;
    if (!json_member(body, length, "params", &params, &params_length) ||
        !json_member(params, params_length, "textDocument", &document, &document_length)) return;
    char *uri = member_string(document, document_length, "uri", NULL);
    char *relative = uri ? virtual_path(uri, 0) : NULL;
    free(uri);
    if (!relative) return;
    char *text = NULL;
    size_t text_length = 0;
    if (opening) text = member_string(document, document_length, "text", &text_length);
    else {
        const char *changes = NULL;
        size_t changes_length = 0;
        if (json_member(params, params_length, "contentChanges", &changes, &changes_length) && *changes == '[') {
            const char *first = skip_ws(changes + 1, changes + changes_length);
            const char *stop = skip_value(first, changes + changes_length);
            const char *range = NULL;
            size_t range_length = 0;
            /* Only a whole-document change says what the file now holds. */
            if (stop && *first == '{' && !json_member(first, (size_t)(stop - first), "range", &range, &range_length))
                text = member_string(first, (size_t)(stop - first), "text", &text_length);
        }
    }
    if (text) mirror_write(relative, text, text_length);
    free(text);
    free(relative);
}

/* flowstudio/forget {uri}: drop a mirrored file, or a folder's contents and
 * the folder itself. 0 when the uri is not a workspace URI. */
static int forget(const char *body, size_t length)
{
    const char *params = NULL;
    size_t params_length = 0;
    if (!json_member(body, length, "params", &params, &params_length)) return 0;
    char *uri = member_string(params, params_length, "uri", NULL);
    char *relative = uri ? virtual_path(uri, 1) : NULL;
    free(uri);
    if (!relative) return 0;
    size_t n = strlen(relative);
    if (n && relative[n - 1] == '/') relative[n - 1] = 0;
    if (mirror && *relative) {
        char *full = mirror_file(relative);
        if (full) remove_tree(full);
        free(full);
    } else if (mirror) {
        remove_tree(mirror);
        mkdir(mirror, 0700);
    }
    free(relative);
    return 1;
}

/* A browser message with each "uri" value moved into the mirror. NULL when
 * a uri is neither a workspace URI nor untitled:. */
static char *map_in(const char *json, size_t length)
{
    const char *end = json + length;
    Buf b = {0};
    int uri_value = 0;
    for (const char *p = json; p < end; ) {
        if (*p != '"') {
            if (*p != ':' && *p != ' ' && *p != '\t' && *p != '\r' && *p != '\n') uri_value = 0;
            buf_put(&b, p, 1);
            p++;
            continue;
        }
        const char *q = skip_string(p, end);
        if (!q) { free(b.data); return NULL; }
        const char *after = skip_ws(q, end);
        if (after < end && *after == ':') {
            uri_value = q - p == 5 && memcmp(p, "\"uri\"", 5) == 0;
            buf_put(&b, p, (size_t)(q - p));
            p = q;
            continue;
        }
        if (uri_value) {
            char *uri = json_string(p, q, NULL);
            char *relative = uri ? virtual_path(uri, 1) : NULL;
            if (!relative && !(uri && strncmp(uri, "untitled:", 9) == 0)) {
                free(uri);
                free(b.data);
                return NULL;
            }
            if (relative && mirror) {
                Buf mapped = {0};
                buf_str(&mapped, mirror_uri);
                buf_str(&mapped, "/");
                buf_str(&mapped, uri + sizeof(VIRTUAL_ROOT) - 1);
                char *text = buf_take(&mapped);
                if (text) json_put_string(&b, text);
                else b.failed = 1;
                free(text);
            } else buf_put(&b, p, (size_t)(q - p));
            free(relative);
            free(uri);
        } else buf_put(&b, p, (size_t)(q - p));
        uri_value = 0;
        p = q;
    }
    return buf_take(&b);
}

static void replace_all(Buf *out, const char *text, const char *from, const char *to)
{
    size_t n = strlen(from);
    for (const char *p = text; ; ) {
        const char *hit = strstr(p, from);
        if (!hit) { buf_str(out, p); return; }
        buf_put(out, p, (size_t)(hit - p));
        buf_str(out, to);
        p = hit + n;
    }
}

/* A server message with the mirror's URI and path made virtual again. */
static char *map_out(char *message)
{
    if (!mirror || !strstr(message, mirror)) return message;
    size_t size = strlen(mirror_uri) + 2;
    char *from_uri = malloc(size), *from_path = malloc(size);
    Buf first = {0}, second = {0};
    char *step = NULL, *out = NULL;
    if (from_uri && from_path) {
        snprintf(from_uri, size, "%s/", mirror_uri);
        snprintf(from_path, size, "%s/", mirror);
        replace_all(&first, message, from_uri, VIRTUAL_ROOT);
        step = buf_take(&first);
        if (step) {
            replace_all(&second, step, from_path, "/flowstudio/");
            out = buf_take(&second);
        }
    }
    free(from_uri);
    free(from_path);
    free(step);
    if (!out) return message;
    free(message);
    return out;
}

/* ---- Notification queue ---- */

static void drop_queued(int index)
{
    queue_bytes -= strlen(queue[index]);
    free(queue[index]);
    memmove(queue + index, queue + index + 1, (size_t)(queue_len - index - 1) * sizeof(char *));
    queue_len--;
}

/* The params.uri of a publishDiagnostics message, as raw JSON text. */
static int diagnostics_uri(const char *json, const char **uri, size_t *uri_length)
{
    const char *params = NULL;
    size_t params_length = 0;
    if (!method_is(json, strlen(json), "textDocument/publishDiagnostics")) return 0;
    if (!json_member(json, strlen(json), "params", &params, &params_length)) return 0;
    return json_member(params, params_length, "uri", uri, uri_length);
}

static void enqueue(char *message)
{
    size_t size = strlen(message);
    if (size > LSP_QUEUE_BYTES) { free(message); return; }
    /* Only the newest diagnostics for a document matter. */
    const char *uri = NULL;
    size_t uri_length = 0;
    if (diagnostics_uri(message, &uri, &uri_length)) {
        for (int i = queue_len - 1; i >= 0; i--) {
            const char *other = NULL;
            size_t other_length = 0;
            if (diagnostics_uri(queue[i], &other, &other_length) &&
                other_length == uri_length && memcmp(other, uri, uri_length) == 0)
                drop_queued(i);
        }
    }
    while (queue_len > 0 && (queue_len >= LSP_QUEUE_MAX || queue_bytes + size > LSP_QUEUE_BYTES))
        drop_queued(0);
    queue[queue_len++] = message;
    queue_bytes += size;
}

/* ---- Child process ---- */

static void stop_child(void)
{
    if (to_child >= 0) close(to_child);
    if (from_child >= 0) close(from_child);
    to_child = from_child = -1;
    if (child > 0) {
        kill(-child, SIGKILL);
        kill(child, SIGKILL);
        while (waitpid(child, NULL, 0) < 0 && errno == EINTR) {}
    }
    child = -1;
    inlen = 0;
    discard_left = 0;
    free(waiting_response);
    waiting_response = NULL;
}

static int child_alive(void)
{
    if (child <= 0) return 0;
    int status = 0;
    pid_t done = waitpid(child, &status, WNOHANG);
    if (done == child || (done < 0 && errno == ECHILD)) {
        child = -1;          /* already reaped */
        stop_child();
        return 0;
    }
    return 1;
}

/* Hand one complete message from the child to its destination. */
static void dispatch(char *message, size_t length)
{
    message = map_out(message);
    length = strlen(message);
    const char *id = NULL;
    size_t id_length = 0;
    int is_request = has_id(message, length, &id, &id_length);
    const char *method = NULL;
    size_t method_length = 0;
    int has_method = json_member(message, length, "method", &method, &method_length);
    if (is_request && !has_method) {
        char wanted[32];
        int n = snprintf(wanted, sizeof(wanted), "%ld", waiting_id);
        if (waiting_id >= 0 && !waiting_response && (size_t)n == id_length && memcmp(id, wanted, id_length) == 0) {
            waiting_response = message;
            return;
        }
        free(message);         /* a response nobody waits for any more */
        return;
    }
    if (has_method && !is_request) { enqueue(message); return; }
    free(message);             /* server-to-client requests are not supported */
}

/* Frame whatever is buffered. */
static void parse_frames(void)
{
    for (;;) {
        if (discard_left > 0) {
            size_t drop = discard_left < inlen ? discard_left : inlen;
            memmove(inbuf, inbuf + drop, inlen - drop);
            inlen -= drop;
            discard_left -= drop;
            if (discard_left > 0) return;
        }
        char *split = NULL;
        for (size_t i = 0; i + 3 < inlen; i++)
            if (memcmp(inbuf + i, "\r\n\r\n", 4) == 0) { split = inbuf + i; break; }
        if (!split) {
            /* A header block never grows this large; resynchronise. */
            if (inlen > LSP_HEADER_MAX) { memmove(inbuf, inbuf + inlen - 3, 3); inlen = 3; }
            return;
        }
        size_t header_length = (size_t)(split - inbuf) + 4;
        long content = -1;
        for (char *line = inbuf; line < split; ) {
            char *eol = line;
            while (eol < split && *eol != '\n') eol++;
            if (eol - line >= 15 && strncasecmp(line, "Content-Length:", 15) == 0)
                content = strtol(line + 15, NULL, 10);
            line = eol + 1;
        }
        if (content < 0) {
            memmove(inbuf, inbuf + header_length, inlen - header_length);
            inlen -= header_length;
            continue;
        }
        if (content > LSP_MESSAGE_MAX) {
            memmove(inbuf, inbuf + header_length, inlen - header_length);
            inlen -= header_length;
            discard_left = (size_t)content;
            continue;
        }
        if (inlen < header_length + (size_t)content) return;
        char *message = malloc((size_t)content + 1);
        if (message) {
            memcpy(message, inbuf + header_length, (size_t)content);
            message[content] = 0;
        }
        size_t used = header_length + (size_t)content;
        memmove(inbuf, inbuf + used, inlen - used);
        inlen -= used;
        if (message) dispatch(message, (size_t)content);
    }
}

/* Read what the child has written so far. -1 when it has gone away. */
static int pump(int timeout_ms)
{
    if (from_child < 0) return -1;
    if (!inbuf) inbuf = malloc(LSP_MESSAGE_MAX + LSP_HEADER_MAX);
    if (!inbuf) return -1;
    struct pollfd p = { from_child, POLLIN, 0 };
    int ready = poll(&p, 1, timeout_ms);
    if (ready < 0) return errno == EINTR ? 0 : -1;
    if (ready == 0) return 0;
    for (;;) {
        size_t room = LSP_MESSAGE_MAX + LSP_HEADER_MAX - inlen;
        if (room == 0) { parse_frames(); room = LSP_MESSAGE_MAX + LSP_HEADER_MAX - inlen; }
        if (room == 0) { inlen = 0; room = LSP_MESSAGE_MAX + LSP_HEADER_MAX; }
        ssize_t got = read(from_child, inbuf + inlen, room);
        if (got > 0) { inlen += (size_t)got; parse_frames(); continue; }
        if (got < 0 && errno == EINTR) continue;
        if (got < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) return 1;
        return -1;             /* EOF or error: the server exited */
    }
}

/* Write one framed message, reading meanwhile so neither side blocks. */
static int send_message(const char *json, size_t length, int64_t deadline)
{
    char header[64];
    int header_length = snprintf(header, sizeof(header), "Content-Length: %zu\r\n\r\n", length);
    const char *parts[2] = { header, json };
    size_t sizes[2] = { (size_t)header_length, length };
    for (int part = 0; part < 2; part++) {
        size_t offset = 0;
        while (offset < sizes[part]) {
            int64_t left = deadline - now_ms();
            if (left <= 0 || to_child < 0) return 0;
            struct pollfd p[2] = { { to_child, POLLOUT, 0 }, { from_child, POLLIN, 0 } };
            int ready = poll(p, 2, (int)(left > 1000 ? 1000 : left));
            if (ready < 0 && errno == EINTR) continue;
            if (ready < 0) return 0;
            if (p[1].revents & (POLLIN | POLLHUP)) { if (pump(0) < 0) return 0; }
            if (p[0].revents & (POLLERR | POLLHUP | POLLNVAL)) return 0;
            if (!(p[0].revents & POLLOUT)) continue;
            ssize_t put = write(to_child, parts[part] + offset, sizes[part] - offset);
            if (put > 0) { offset += (size_t)put; continue; }
            if (put < 0 && (errno == EINTR || errno == EAGAIN || errno == EWOULDBLOCK)) continue;
            return 0;
        }
    }
    return 1;
}

/* Send a request with a bridge id and wait for its response. */
static char *round_trip(const char *json, size_t length, const char *id_at, size_t id_length, int64_t deadline)
{
    char id[32];
    long mine = next_id++;
    int n = snprintf(id, sizeof(id), "%ld", mine);
    char *forward = id_at ? splice(json, length, id_at, id_length, id, (size_t)n) : NULL;
    if (!forward) return NULL;
    free(waiting_response);
    waiting_response = NULL;
    waiting_id = mine;
    int sent = send_message(forward, strlen(forward), deadline);
    free(forward);
    while (sent && !waiting_response) {
        int64_t left = deadline - now_ms();
        if (left <= 0) break;
        if (pump((int)left) < 0) break;
    }
    waiting_id = -1;
    char *response = waiting_response;
    waiting_response = NULL;
    return response;
}

static int start_child(void)
{
    if (child_alive()) return 1;
    if (failed_at >= 0 && now_ms() - failed_at < LSP_RETRY_MS) return 0;
    signal(SIGPIPE, SIG_IGN);
    int input[2], output[2];
    if (pipe(input) != 0) return 0;
    if (pipe(output) != 0) { close(input[0]); close(input[1]); return 0; }
    pid_t pid = fork();
    if (pid < 0) {
        close(input[0]); close(input[1]); close(output[0]); close(output[1]);
        return 0;
    }
    if (pid == 0) {
        (void)setpgid(0, 0);
        if (dup2(input[0], STDIN_FILENO) < 0 || dup2(output[1], STDOUT_FILENO) < 0) _exit(127);
        int devnull = open("/dev/null", O_WRONLY);
        if (devnull >= 0) dup2(devnull, STDERR_FILENO);
        for (int fd = 3; fd < 1024; fd++) close(fd);
        signal(SIGPIPE, SIG_DFL);
        unsetenv("FLOWSTUDIO_PORT");
        execlp("flow", "flow", "lsp", (char *)NULL);
        _exit(127);
    }
    (void)setpgid(pid, pid);
    close(input[0]);
    close(output[1]);
    to_child = input[1];
    from_child = output[0];
    fcntl(to_child, F_SETFL, fcntl(to_child, F_GETFL, 0) | O_NONBLOCK);
    fcntl(from_child, F_SETFL, fcntl(from_child, F_GETFL, 0) | O_NONBLOCK);
    fcntl(to_child, F_SETFD, FD_CLOEXEC);
    fcntl(from_child, F_SETFD, FD_CLOEXEC);
    child = pid;
    inlen = 0;
    discard_left = 0;

    char init[160];
    int init_length = snprintf(init, sizeof(init),
        "{\"jsonrpc\":\"2.0\",\"id\":0,\"method\":\"initialize\",\"params\":"
        "{\"processId\":%ld,\"rootUri\":null,\"capabilities\":{}}}", (long)getpid());
    const char *id_at = strstr(init, "\"id\":0") + 5;
    char *response = round_trip(init, (size_t)init_length, id_at, 1, now_ms() + LSP_START_MS);
    const char *result = NULL;
    size_t result_length = 0;
    if (!response || !json_member(response, strlen(response), "result", &result, &result_length)) {
        free(response);
        stop_child();
        failed_at = now_ms();
        return 0;
    }
    free(capabilities);
    capabilities = malloc(result_length + 1);
    if (capabilities) { memcpy(capabilities, result, result_length); capabilities[result_length] = 0; }
    free(response);
    const char *initialized = "{\"jsonrpc\":\"2.0\",\"method\":\"initialized\",\"params\":{}}";
    send_message(initialized, strlen(initialized), now_ms() + LSP_REQUEST_MS);
    failed_at = -1;
    generation++;
    char *started = malloc(96);
    if (started) {
        snprintf(started, 96, "{\"jsonrpc\":\"2.0\",\"method\":\"flowstudio/serverStarted\",\"params\":{\"generation\":%d}}", generation);
        enqueue(started);
    }
    return 1;
}

static const char *unavailable(void)
{
    return fail(503, "The Flow language server is unavailable. Install Flow 2.x so `flow lsp` is on PATH.");
}

static const char *request(const char *body)
{
    size_t length = body ? strlen(body) : 0;
    const char *method = NULL;
    size_t method_length = 0;
    if (!length || !json_member(body, length, "method", &method, &method_length) || *method != '"')
        return fail(400, "Expected one JSON-RPC message with a method.");
    if (method_is(body, length, "shutdown") || method_is(body, length, "exit"))
        return fail(400, "The language server is shared; FlowStudio manages its lifetime.");
    ensure_mirror();
    if (method_is(body, length, "flowstudio/forget")) {
        if (has_id(body, length, NULL, NULL) || !forget(body, length))
            return fail(400, "flowstudio/forget is a notification with a workspace uri.");
        return set_reply(200, strdup("null"));
    }
    free(forwarded);
    forwarded = map_in(body, length);
    if (!forwarded)
        return fail(400, "Document URIs must stay inside file:///flowstudio/.");
    mirror_document(body, length);
    body = forwarded;
    length = strlen(body);
    const char *id = NULL;
    size_t id_length = 0;
    int is_request = has_id(body, length, &id, &id_length);
    if (!start_child()) return unavailable();

    if (method_is(body, length, "initialize")) {
        if (!is_request) return fail(400, "initialize needs an id.");
        size_t size = id_length + strlen(capabilities ? capabilities : "null") + 48;
        char *out = malloc(size);
        if (!out) return fail(503, "Out of memory.");
        snprintf(out, size, "{\"jsonrpc\":\"2.0\",\"id\":%.*s,\"result\":%s}", (int)id_length, id,
                 capabilities ? capabilities : "null");
        return set_reply(200, out);
    }

    for (int attempt = 0; attempt < 2; attempt++) {
        int64_t deadline = now_ms() + LSP_REQUEST_MS;
        if (!is_request) {
            if (send_message(body, length, deadline)) {
                pump(0);
                return set_reply(200, strdup("null"));
            }
        } else {
            char *response = round_trip(body, length, id, id_length, deadline);
            if (response) {
                const char *rid = NULL;
                size_t rid_length = 0;
                char *out = has_id(response, strlen(response), &rid, &rid_length)
                    ? splice(response, strlen(response), rid, rid_length, id, id_length) : NULL;
                free(response);
                if (!out) return fail(503, "Malformed language server response.");
                return set_reply(200, out);
            }
            if (child_alive()) return fail(504, "The Flow language server did not answer within 3 seconds.");
        }
        /* The server exited: start a fresh one and try once more. */
        stop_child();
        if (!start_child()) return unavailable();
    }
    return unavailable();
}

static const char *events(void)
{
    if (child > 0 && child_alive()) {
        for (int rounds = 0; rounds < 64; rounds++)
            if (pump(0) <= 0) break;
    }
    size_t size = 3;
    for (int i = 0; i < queue_len; i++) size += strlen(queue[i]) + 1;
    char *out = malloc(size);
    if (!out) return fail(503, "Out of memory.");
    size_t at = 0;
    out[at++] = '[';
    for (int i = 0; i < queue_len; i++) {
        if (i) out[at++] = ',';
        size_t n = strlen(queue[i]);
        memcpy(out + at, queue[i], n);
        at += n;
    }
    out[at++] = ']';
    out[at] = 0;
    while (queue_len > 0) drop_queued(queue_len - 1);
    return set_reply(200, out);
}

static const char *status(void)
{
    int running = child_alive();
    char *out = malloc(128);
    if (!out) return fail(503, "Out of memory.");
    snprintf(out, 128, "{\"running\":%s,\"pid\":%ld,\"generation\":%d,\"queued\":%d}",
             running ? "true" : "false", running ? (long)child : 0L, generation, queue_len);
    return set_reply(200, out);
}

/* Starts the server if it is not running. Always 200, so a browser that
 * only wants to know whether Flow has a language server logs no error. */
static const char *start(void)
{
    int running = child_alive() || start_child();
    return set_reply(200, strdup(running ? "{\"available\":true}" : "{\"available\":false}"));
}

const char *fs_lsp(const char *op, const char *body)
{
    if (!op) return fail(400, "Bad language server request.");
    if (strcmp(op, "request") == 0) return request(body);
    if (strcmp(op, "events") == 0) return events();
    if (strcmp(op, "status") == 0) return status();
    if (strcmp(op, "start") == 0) return start();
    return fail(400, "Unknown language server operation.");
}
