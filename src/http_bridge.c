/*
 * FlowStudio loopback HTTP transport.
 * Platform-facing C is deliberately limited to sockets, request parsing,
 * temporary files and response writes. Routing/execution remain in Flow.
 * Single client at a time. Not a hardened multi-user server.
 */
#ifndef _GNU_SOURCE
#define _GNU_SOURCE
#endif
#include <arpa/inet.h>
#include <errno.h>
#include <netinet/in.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <sys/socket.h>
#include <sys/time.h>
#include <unistd.h>

enum { FS_HEADER_LIMIT = 8192, FS_BODY_LIMIT = 131072 };
static int fs_client = -1;
static char fs_headers[FS_HEADER_LIMIT + 1];
static char fs_payload[FS_BODY_LIMIT + 1];
static char fs_http_method[12];
static char fs_http_path[256];

static int fs_write_all(int fd, const char *data, size_t n)
{
    size_t off = 0;
    while (off < n)
    {
        ssize_t count = send(fd, data + off, n - off, 0);
        if (count < 0 && errno == EINTR) continue;
        if (count <= 0) return -1;
        off += (size_t)count;
    }
    return 0;
}

void fs_reply(int code, const char *content_type, const char *body)
{
    if (fs_client < 0) return;
    if (!body) body = "";
    if (!content_type) content_type = "text/plain; charset=utf-8";

    const char *reason = code == 200 ? "OK" :
        code == 400 ? "Bad Request" :
        code == 403 ? "Forbidden" :
        code == 404 ? "Not Found" :
        code == 411 ? "Length Required" :
        code == 413 ? "Payload Too Large" : "Internal Server Error";
    char header[1024];
    int n = snprintf(header, sizeof(header),
        "HTTP/1.1 %d %s\r\n"
        "Content-Type: %s\r\n"
        "Content-Length: %zu\r\n"
        "Cache-Control: no-store\r\n"
        "X-Content-Type-Options: nosniff\r\n"
        "X-Frame-Options: DENY\r\n"
        "Referrer-Policy: no-referrer\r\n"
        "Connection: close\r\n\r\n",
        code, reason, content_type, strlen(body));

    if (n > 0 && (size_t)n < sizeof(header))
    {
        (void)fs_write_all(fs_client, header, (size_t)n);
        (void)fs_write_all(fs_client, body, strlen(body));
    }
    close(fs_client);
    fs_client = -1;
}

int fs_listen(int port)
{
    if (port <= 0 || port > 65535) return -1;
    signal(SIGPIPE, SIG_IGN);

    int fd = socket(AF_INET, SOCK_STREAM, 0);
    if (fd < 0) return -1;
    int reuse = 1;
    (void)setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &reuse, sizeof(reuse));

    struct sockaddr_in addr;
    memset(&addr, 0, sizeof(addr));
    addr.sin_family = AF_INET;
    addr.sin_port = htons((unsigned short)port);
    addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    if (bind(fd, (struct sockaddr *)&addr, sizeof(addr)) != 0 ||
        listen(fd, 8) != 0)
    {
        close(fd);
        return -1;
    }
    return fd;
}

static const char *fs_header_value(const char *name)
{
    size_t expected = strlen(name);
    const char *p = strstr(fs_headers, "\r\n");
    while (p && p[2] != '\r' && p[2] != '\n' && p[2] != '\0')
    {
        p += 2;
        const char *end = strstr(p, "\r\n");
        if (!end) break;
        const char *colon = memchr(p, ':', (size_t)(end - p));
        if (colon && (size_t)(colon - p) == expected &&
            strncasecmp(p, name, expected) == 0)
        {
            const char *value = colon + 1;
            while (value < end && (*value == ' ' || *value == '\t')) value++;
            return value;
        }
        p = end;
    }
    return NULL;
}

int fs_intent_allowed(void)
{
    /* A custom header requires a CORS preflight from other browser origins;
       this server never grants cross-origin requests. */
    const char *intent = fs_header_value("X-FlowStudio-Intent");
    if (!intent || strncmp(intent, "run\r\n", 5) != 0) return 0;
    const char *origin = fs_header_value("Origin");
    if (origin)
    {
        if (strncmp(origin, "http://127.0.0.1:8751\r\n", 23) != 0 &&
            strncmp(origin, "http://localhost:8751\r\n", 23) != 0)
            return 0;
    }
    return 1;
}

int fs_read_request(int listener)
{
    fs_client = accept(listener, NULL, NULL);
    if (fs_client < 0) return 0;

    struct timeval tv = { 10, 0 };
    (void)setsockopt(fs_client, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));
    memset(fs_headers, 0, sizeof(fs_headers));
    memset(fs_payload, 0, sizeof(fs_payload));
    memset(fs_http_method, 0, sizeof(fs_http_method));
    memset(fs_http_path, 0, sizeof(fs_http_path));

    int n = 0;
    while (n < FS_HEADER_LIMIT)
    {
        ssize_t got = recv(fs_client, fs_headers + n, 1, 0);
        if (got <= 0)
        {
            fs_reply(400, "text/plain", "Incomplete request headers");
            return 0;
        }
        n++;
        fs_headers[n] = 0;
        if (n >= 4 && memcmp(fs_headers + n - 4, "\r\n\r\n", 4) == 0)
            break;
    }
    if (n >= FS_HEADER_LIMIT ||
        sscanf(fs_headers, "%11s %255s HTTP/%*s", fs_http_method, fs_http_path) != 2)
    {
        fs_reply(400, "text/plain", "Malformed request");
        return 0;
    }

    if (strcmp(fs_http_method, "POST") == 0)
    {
        const char *field = fs_header_value("Content-Length");
        if (!field)
        {
            fs_reply(411, "text/plain", "Content-Length required");
            return 0;
        }
        char *end = NULL;
        long length = strtol(field, &end, 10);
        if (!end || end == field || length < 0 || length > FS_BODY_LIMIT ||
            (*end != '\r' && *end != '\n'))
        {
            fs_reply(413, "text/plain", "Invalid or oversized body");
            return 0;
        }
        int off = 0;
        while (off < length)
        {
            ssize_t got = recv(fs_client, fs_payload + off,
                               (size_t)(length - off), 0);
            if (got <= 0)
            {
                fs_reply(400, "text/plain", "Incomplete request body");
                return 0;
            }
            off += (int)got;
        }
        fs_payload[off] = 0;
        if (memchr(fs_payload, 0, (size_t)off))
        {
            fs_reply(400, "text/plain", "NUL bytes not supported");
            return 0;
        }
    }
    return 1;
}

const char *fs_method(void) { return fs_http_method; }
const char *fs_path(void) { return fs_http_path; }
const char *fs_body(void) { return fs_payload; }

const char *fs_write_temp_flow(const char *code)
{
    static char path[64];
    strcpy(path, "/tmp/flowstudio-XXXXXX.flow");
    int fd = mkstemps(path, 5);
    if (fd < 0) return "";

    const char *p = code;
    size_t remaining = strlen(code);
    while (remaining > 0)
    {
        ssize_t n = write(fd, p, remaining);
        if (n < 0 && errno == EINTR) continue;
        if (n <= 0)
        {
            close(fd);
            unlink(path);
            return "";
        }
        p += n;
        remaining -= (size_t)n;
    }
    if (close(fd) != 0)
    {
        unlink(path);
        return "";
    }
    return path;
}
