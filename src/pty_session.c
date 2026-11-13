/*
 * FlowStudio integrated terminal: real pseudo-terminals running the user's
 * login shell, the same trust level as the existing local code execution.
 * Routes stay in Flow (src/main.flow) behind the intent and origin gate; this
 * file owns only the POSIX pty mechanics.
 *
 * The browser polls for output. Each request names a session by number:
 *   open    body "COLS ROWS"        -> "ID"
 *   write   body "ID\n<bytes>"      -> ""
 *   read    body "ID"               -> pending output (may be empty)
 *   resize  body "ID COLS ROWS"     -> ""
 *   close   body "ID"               -> ""
 * fs_pty_status() reports 200, 400 (bad request), 404 (unknown session),
 * 410 (shell exited; read returns the final output first) or 503.
 */
#ifndef _GNU_SOURCE
#define _GNU_SOURCE
#endif
#if defined(__APPLE__)
#define _DARWIN_C_SOURCE
#include <util.h>
#else
#include <pty.h>
#endif
#include <errno.h>
#include <fcntl.h>
#include <pwd.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/resource.h>
#include <sys/wait.h>
#include <termios.h>
#include <time.h>
#include <unistd.h>

enum { PTY_MAX = 8, PTY_READ_LIMIT = 98304, PTY_ORPHAN_SECONDS = 150, PTY_RECLAIM_SECONDS = 5 };

struct pty_session {
    int fd;
    pid_t pid;
    int exited;
    int next_id;
    unsigned char carry[4];   /* incomplete UTF-8 tail held for the next read */
    int carry_len;
    time_t last_seen;         /* last read; a page reload orphans its shells */
};

static struct pty_session sessions[PTY_MAX];
static int next_session_id = 1;
static int pty_last_status = 200;
static char pty_out[PTY_READ_LIMIT + 8];

int fs_pty_status(void) { return pty_last_status; }

static struct pty_session *find_session(int id)
{
    for (int i = 0; i < PTY_MAX; i++)
        if (sessions[i].fd > 0 && sessions[i].next_id == id) return &sessions[i];
    return NULL;
}

static void reap(struct pty_session *s)
{
    if (s->pid <= 0 || s->exited) return;
    int status = 0;
    if (waitpid(s->pid, &status, WNOHANG) == s->pid) s->exited = 1;
}

static void close_session(struct pty_session *s)
{
    if (s->fd > 0) close(s->fd);
    if (s->pid > 0 && !s->exited) {
        kill(-s->pid, SIGHUP);
        kill(s->pid, SIGHUP);
        int status = 0;
        for (int tries = 0; tries < 20; tries++) {
            if (waitpid(s->pid, &status, WNOHANG) == s->pid) break;
            usleep(5000);
        }
        if (waitpid(s->pid, &status, WNOHANG) == 0) {
            kill(-s->pid, SIGKILL);
            kill(s->pid, SIGKILL);
            waitpid(s->pid, &status, 0);
        }
    }
    memset(s, 0, sizeof(*s));
}

static int parse_size(const char *text, int *cols, int *rows)
{
    int c = 0, r = 0;
    if (!text || sscanf(text, "%d %d", &c, &r) != 2) return -1;
    if (c < 10 || c > 1000 || r < 2 || r > 500) return -1;
    *cols = c;
    *rows = r;
    return 0;
}

static const char *open_session(const char *body)
{
    int cols = 0, rows = 0;
    if (parse_size(body, &cols, &rows) != 0) { pty_last_status = 400; return "Expected COLS ROWS."; }
    struct pty_session *slot = NULL;
    time_t now = time(NULL);
    for (int i = 0; i < PTY_MAX; i++) {
        if (sessions[i].fd > 0) reap(&sessions[i]);
        /* Live pages poll every second, and at least once a minute when Chrome
           throttles a background tab; an unread shell belongs to a closed page. */
        if (sessions[i].fd > 0 && (sessions[i].exited || now - sessions[i].last_seen > PTY_ORPHAN_SECONDS))
            close_session(&sessions[i]);
        if (!slot && sessions[i].fd <= 0) slot = &sessions[i];
    }
    /* Full: reclaim the shell nobody has read for longest, if that is long
       enough to rule out a live page (they poll at least every second). */
    if (!slot) {
        struct pty_session *stale = NULL;
        for (int i = 0; i < PTY_MAX; i++)
            if (!stale || sessions[i].last_seen < stale->last_seen) stale = &sessions[i];
        if (stale && now - stale->last_seen > PTY_RECLAIM_SECONDS) {
            close_session(stale);
            slot = stale;
        }
    }
    if (!slot) { pty_last_status = 503; return "Too many open terminals. Close one first."; }

    struct winsize size = { (unsigned short)rows, (unsigned short)cols, 0, 0 };
    int master = -1;
    pid_t pid = forkpty(&master, NULL, NULL, &size);
    if (pid < 0) { pty_last_status = 503; return "Unable to create a pseudo-terminal."; }
    if (pid == 0) {
        /* Child: drop the server's sockets and pipes, then become the shell. */
        struct rlimit limit;
        int top = (getrlimit(RLIMIT_NOFILE, &limit) == 0 && limit.rlim_cur != RLIM_INFINITY &&
                   limit.rlim_cur < 65536) ? (int)limit.rlim_cur : 4096;
        for (int fd = 3; fd < top; fd++) close(fd);
        signal(SIGPIPE, SIG_DFL);
        signal(SIGCHLD, SIG_DFL);
        signal(SIGINT, SIG_DFL);
        signal(SIGTERM, SIG_DFL);
        const char *shell = getenv("SHELL");
        if (!shell || !*shell) {
            struct passwd *pw = getpwuid(getuid());
            shell = (pw && pw->pw_shell && *pw->pw_shell) ? pw->pw_shell : "/bin/sh";
        }
        setenv("TERM", "xterm-256color", 1);
        setenv("COLORTERM", "truecolor", 1);
        setenv("TERM_PROGRAM", "FlowStudio", 1);
        unsetenv("FLOWSTUDIO_PORT");
        const char *base = strrchr(shell, '/');
        char argv0[256];
        snprintf(argv0, sizeof(argv0), "-%s", base ? base + 1 : shell);   /* login shell */
        execl(shell, argv0, (char *)NULL);
        execl("/bin/sh", "-sh", (char *)NULL);
        _exit(127);
    }
    int flags = fcntl(master, F_GETFL, 0);
    fcntl(master, F_SETFL, flags | O_NONBLOCK);
    fcntl(master, F_SETFD, FD_CLOEXEC);
    memset(slot, 0, sizeof(*slot));
    slot->fd = master;
    slot->pid = pid;
    slot->next_id = next_session_id++;
    slot->last_seen = now;
    static char id[24];
    snprintf(id, sizeof(id), "%d", slot->next_id);
    pty_last_status = 200;
    return id;
}

static struct pty_session *session_from(const char *body, const char **rest)
{
    char *end = NULL;
    long id = body ? strtol(body, &end, 10) : 0;
    if (!body || end == body || id <= 0) { pty_last_status = 400; return NULL; }
    struct pty_session *s = find_session((int)id);
    if (!s) { pty_last_status = 404; return NULL; }
    s->last_seen = time(NULL);
    if (rest) *rest = end;
    return s;
}

/* Length of a trailing incomplete UTF-8 sequence, 0 when the tail is whole. */
static int utf8_tail(const unsigned char *buf, int len)
{
    for (int back = 1; back <= 3 && back <= len; back++) {
        unsigned char c = buf[len - back];
        if ((c & 0xC0) == 0x80) continue;                  /* continuation byte */
        int need = (c & 0xE0) == 0xC0 ? 2 : (c & 0xF0) == 0xE0 ? 3 : (c & 0xF8) == 0xF0 ? 4 : 1;
        return need > back ? back : 0;
    }
    return 0;
}

static const char *read_session(const char *body)
{
    struct pty_session *s = session_from(body, NULL);
    if (!s) return "";
    int len = 0;
    if (s->carry_len) { memcpy(pty_out, s->carry, (size_t)s->carry_len); len = s->carry_len; s->carry_len = 0; }
    for (;;) {
        if (len >= PTY_READ_LIMIT) break;
        ssize_t got = read(s->fd, pty_out + len, (size_t)(PTY_READ_LIMIT - len));
        if (got > 0) { len += (int)got; continue; }
        if (got < 0 && errno == EINTR) continue;
        /* EOF, or EIO on Linux once the last slave fd closes: the shell is gone. */
        if (got == 0 || (got < 0 && errno != EAGAIN && errno != EWOULDBLOCK)) {
            reap(s);
            s->exited = 1;
        }
        break;
    }
    int tail = s->exited ? 0 : utf8_tail((unsigned char *)pty_out, len);
    if (tail) { memcpy(s->carry, pty_out + len - tail, (size_t)tail); s->carry_len = tail; len -= tail; }
    /* Responses are C strings: drop NUL bytes, which terminals ignore anyway. */
    int w = 0;
    for (int r = 0; r < len; r++) if (pty_out[r]) pty_out[w++] = pty_out[r];
    pty_out[w] = 0;
    if (s->exited && w == 0) { close_session(s); pty_last_status = 410; return ""; }
    pty_last_status = s->exited ? 410 : 200;
    if (s->exited) close_session(s);
    return pty_out;
}

static const char *write_session(const char *body)
{
    const char *rest = NULL;
    struct pty_session *s = session_from(body, &rest);
    if (!s) return "";
    if (*rest != '\n') { pty_last_status = 400; return "Expected ID newline data."; }
    rest++;
    size_t left = strlen(rest);
    int spins = 0;
    while (left > 0) {
        ssize_t put = write(s->fd, rest, left);
        if (put > 0) { rest += put; left -= (size_t)put; continue; }
        if (put < 0 && errno == EINTR) continue;
        if (put < 0 && (errno == EAGAIN || errno == EWOULDBLOCK) && spins++ < 200) { usleep(2000); continue; }
        pty_last_status = 410;
        return "The shell is no longer accepting input.";
    }
    pty_last_status = 200;
    return "";
}

static const char *resize_session(const char *body)
{
    const char *rest = NULL;
    struct pty_session *s = session_from(body, &rest);
    if (!s) return "";
    int cols = 0, rows = 0;
    if (parse_size(rest, &cols, &rows) != 0) { pty_last_status = 400; return "Expected ID COLS ROWS."; }
    struct winsize size = { (unsigned short)rows, (unsigned short)cols, 0, 0 };
    ioctl(s->fd, TIOCSWINSZ, &size);
    if (s->pid > 0) kill(-s->pid, SIGWINCH);
    pty_last_status = 200;
    return "";
}

static const char *close_request(const char *body)
{
    struct pty_session *s = session_from(body, NULL);
    if (!s) return "";
    close_session(s);
    pty_last_status = 200;
    return "";
}

const char *fs_pty(const char *op, const char *body)
{
    pty_last_status = 400;
    if (!op || !body) return "Bad terminal request.";
    if (strcmp(op, "open") == 0) return open_session(body);
    if (strcmp(op, "read") == 0) return read_session(body);
    if (strcmp(op, "write") == 0) return write_session(body);
    if (strcmp(op, "resize") == 0) return resize_session(body);
    if (strcmp(op, "close") == 0) return close_request(body);
    return "Unknown terminal operation.";
}
