/*
 * FlowStudio assistant bridge: runs the user's own AI command line tool
 * (Claude Code, Codex or Ollama) as one child process per prompt, and keeps
 * the editor snapshot and edit proposals that the MCP server reads and
 * writes. Routes stay in Flow (src/main.flow) behind the intent and origin
 * gate. Nothing here blocks the HTTP loop: start returns a job id at once
 * and the browser polls.
 *
 *   providers                         -> JSON list of installed tools
 *   start   "provider\nmodel\nruns\n<prompt>"  -> "ID"
 *   poll    "ID"   -> "<state>\n<new stdout>" and, once finished,
 *                     "\x1e<stderr tail>". state: running, exit N,
 *                     timeout, cancelled
 *   cancel  "ID"
 *   context-set <json>, context-get
 *   propose <json object> -> "ID", proposals -> JSON array (drains it)
 *
 * Billing safety: API key variables are removed from the child environment
 * so each tool uses the user's own login. The child runs in a private
 * temporary directory in its own process group.
 */
#ifndef _GNU_SOURCE
#define _GNU_SOURCE
#endif
#if defined(__APPLE__)
#define _DARWIN_C_SOURCE
#endif
#include <errno.h>
#include <fcntl.h>
#include <ftw.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/resource.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

extern char **environ;
int fs_port(void);
const char *fs_origin(void);

enum {
    AS_MAX_JOBS = 4,
    AS_CHUNK = 262144,
    AS_TAIL = 8192,
    AS_ORPHAN_SECONDS = 90,
    AS_CONTEXT_LIMIT = 131072,
    AS_MAX_PROPOSALS = 16
};

struct as_job {
    int id;
    pid_t pid;
    int out_fd, err_fd;
    int exited, exit_code, out_eof;
    int timed_out, cancelled;
    time_t started, last_seen;
    char dir[96];
    char tail[AS_TAIL + 1];
    size_t tail_len;
};

static struct as_job jobs[AS_MAX_JOBS];
static int next_job_id = 1;
static int as_status = 200;
static char *as_reply = NULL;
static char *context_json = NULL;
static char *proposals[AS_MAX_PROPOSALS];
static int proposal_count = 0;
static int next_proposal_id = 1;

int fs_assistant_status(void) { return as_status; }

static const char *reply_owned(char *text, int status)
{
    free(as_reply);
    as_reply = text ? text : strdup("");
    as_status = status;
    return as_reply ? as_reply : "";
}

static const char *reply_copy(const char *text, int status)
{
    return reply_owned(strdup(text ? text : ""), status);
}

/* ---------- small string builder ---------- */
struct sb { char *data; size_t len, cap; };

static void sb_add(struct sb *b, const char *s, size_t n)
{
    if (!b->data || b->len + n + 1 > b->cap) {
        size_t cap = b->cap ? b->cap : 1024;
        while (b->len + n + 1 > cap) cap *= 2;
        char *grown = realloc(b->data, cap);
        if (!grown) return;
        b->data = grown;
        b->cap = cap;
    }
    memcpy(b->data + b->len, s, n);
    b->len += n;
    b->data[b->len] = 0;
}
static void sb_str(struct sb *b, const char *s) { sb_add(b, s, strlen(s)); }

/* JSON and TOML basic strings share these escapes. */
static void sb_quoted(struct sb *b, const char *s)
{
    sb_str(b, "\"");
    for (const unsigned char *p = (const unsigned char *)s; *p; p++) {
        char esc[8];
        if (*p == '"' || *p == '\\') { esc[0] = '\\'; esc[1] = (char)*p; sb_add(b, esc, 2); }
        else if (*p == '\n') sb_str(b, "\\n");
        else if (*p == '\t') sb_str(b, "\\t");
        else if (*p < 0x20) { snprintf(esc, sizeof(esc), "\\u%04x", *p); sb_str(b, esc); }
        else sb_add(b, (const char *)p, 1);
    }
    sb_str(b, "\"");
}

static char *read_file(const char *path)
{
    FILE *f = fopen(path, "rb");
    if (!f) return NULL;
    struct sb b = {0};
    char buf[8192];
    size_t n;
    while ((n = fread(buf, 1, sizeof(buf), f)) > 0) sb_add(&b, buf, n);
    fclose(f);
    if (!b.data) return strdup("");
    return b.data;
}

static int write_file(const char *path, const char *text)
{
    int fd = open(path, O_WRONLY | O_CREAT | O_TRUNC, 0600);
    if (fd < 0) return -1;
    size_t left = strlen(text);
    while (left > 0) {
        ssize_t n = write(fd, text, left);
        if (n < 0 && errno == EINTR) continue;
        if (n <= 0) { close(fd); return -1; }
        text += n;
        left -= (size_t)n;
    }
    return close(fd);
}

/* ---------- finding tools ---------- */
static const char *extra_dirs(int index)
{
    static char local_bin[512];
    const char *home = getenv("HOME");
    snprintf(local_bin, sizeof(local_bin), "%s/.local/bin", home ? home : "/nonexistent");
    const char *dirs[] = { "/opt/homebrew/bin", "/usr/local/bin", local_bin, "/usr/bin", "/bin" };
    return index < 5 ? dirs[index] : NULL;
}

/* Absolute path of an executable on PATH or a common install folder. */
static int find_tool(const char *name, char *out, size_t cap)
{
    const char *path = getenv("PATH");
    char *copy = strdup(path ? path : "");
    for (char *save = NULL, *dir = strtok_r(copy, ":", &save); dir; dir = strtok_r(NULL, ":", &save)) {
        if (!*dir) continue;
        snprintf(out, cap, "%s/%s", dir, name);
        if (access(out, X_OK) == 0) { free(copy); return 1; }
    }
    free(copy);
    for (int i = 0; extra_dirs(i); i++) {
        snprintf(out, cap, "%s/%s", extra_dirs(i), name);
        if (access(out, X_OK) == 0) return 1;
    }
    out[0] = 0;
    return 0;
}

/* Variables that would bill an API account or a cloud account instead of
 * the user's own login. Anything ending in _API_KEY or _AUTH_TOKEN goes. */
static int billing_variable(const char *entry)
{
    const char *eq = strchr(entry, '=');
    size_t n = eq ? (size_t)(eq - entry) : strlen(entry);
    static const char *suffixes[] = { "_API_KEY", "_AUTH_TOKEN", "_ACCESS_KEY_ID", "_SECRET_ACCESS_KEY", "_SESSION_TOKEN" };
    for (size_t i = 0; i < sizeof(suffixes) / sizeof(*suffixes); i++) {
        size_t s = strlen(suffixes[i]);
        if (n >= s && strncmp(entry + n - s, suffixes[i], s) == 0) return 1;
    }
    static const char *names[] = {
        "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "CODEX_API_KEY", "CLAUDE_CODE_USE_BEDROCK",
        "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY", "AWS_BEARER_TOKEN_BEDROCK",
        "ANTHROPIC_BEDROCK_BASE_URL", "ANTHROPIC_VERTEX_PROJECT_ID", "GOOGLE_APPLICATION_CREDENTIALS",
        "OPENAI_BASE_URL", "OPENAI_ORG_ID", "FLOWSTUDIO_PORT", "FLOWSTUDIO_URL", "PATH",
        "FLOWSTUDIO_MCP_MODE", "FLOWSTUDIO_MCP_RUN", "CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", NULL
    };
    for (int i = 0; names[i]; i++)
        if (strlen(names[i]) == n && strncmp(entry, names[i], n) == 0) return 1;
    return 0;
}

static char **child_environment(const char *tool_dir, const char *python_dir, int allow_runs)
{
    int count = 0;
    while (environ[count]) count++;
    char **env = calloc((size_t)count + 8, sizeof(char *));
    if (!env) return NULL;
    int k = 0;
    for (int i = 0; i < count; i++)
        if (!billing_variable(environ[i])) env[k++] = strdup(environ[i]);
    struct sb path = {0};
    sb_str(&path, "PATH=");
    sb_str(&path, tool_dir);
    sb_str(&path, ":");
    sb_str(&path, python_dir);
    const char *old = getenv("PATH");
    if (old && *old) { sb_str(&path, ":"); sb_str(&path, old); }
    for (int i = 0; extra_dirs(i); i++) { sb_str(&path, ":"); sb_str(&path, extra_dirs(i)); }
    env[k++] = path.data;
    char url[96];
    snprintf(url, sizeof(url), "FLOWSTUDIO_URL=%s", fs_origin());
    env[k++] = strdup(url);
    env[k++] = strdup("FLOWSTUDIO_MCP_MODE=assistant");
    env[k++] = strdup(allow_runs ? "FLOWSTUDIO_MCP_RUN=flow" : "FLOWSTUDIO_MCP_RUN=none");
    env[k++] = strdup("NO_COLOR=1");
    env[k] = NULL;
    return env;
}

static void free_strings(char **list)
{
    if (!list) return;
    for (int i = 0; list[i]; i++) free(list[i]);
    free(list);
}

static void dirname_of(const char *path, char *out, size_t cap)
{
    snprintf(out, cap, "%s", path);
    char *slash = strrchr(out, '/');
    if (slash && slash != out) *slash = 0;
}

/* Run a short fixed command and capture its stdout, for `ollama list`. */
static char *capture(char *const argv[], int limit_ms)
{
    int pipefd[2];
    if (pipe(pipefd) != 0) return NULL;
    pid_t pid = fork();
    if (pid < 0) { close(pipefd[0]); close(pipefd[1]); return NULL; }
    if (pid == 0) {
        dup2(pipefd[1], 1);
        int null = open("/dev/null", O_RDWR);
        if (null >= 0) { dup2(null, 0); dup2(null, 2); }
        for (int fd = 3; fd < 1024; fd++) close(fd);
        execv(argv[0], argv);
        _exit(127);
    }
    close(pipefd[1]);
    fcntl(pipefd[0], F_SETFL, O_NONBLOCK);
    struct sb out = {0};
    char buf[4096];
    int waited = 0, status = 0, done = 0;
    while (waited < limit_ms) {
        ssize_t n = read(pipefd[0], buf, sizeof(buf));
        if (n > 0) { sb_add(&out, buf, (size_t)n); continue; }
        if (n == 0) { done = 1; break; }
        usleep(10000);
        waited += 10;
    }
    close(pipefd[0]);
    if (!done) kill(pid, SIGKILL);
    waitpid(pid, &status, 0);
    if (!done || !WIFEXITED(status) || WEXITSTATUS(status) != 0) { free(out.data); return NULL; }
    return out.data ? out.data : strdup("");
}

/* ---------- providers ---------- */
static const char *fake_provider(void)
{
    const char *fake = getenv("FLOWSTUDIO_ASSISTANT_FAKE");
    return fake && *fake && access(fake, X_OK) == 0 ? fake : NULL;
}

static void provider_entry(struct sb *b, int *first, const char *id, const char *name,
                           const char *path, int mcp)
{
    if (!*first) sb_str(b, ",");
    *first = 0;
    sb_str(b, "{\"id\":");
    sb_quoted(b, id);
    sb_str(b, ",\"name\":");
    sb_quoted(b, name);
    sb_str(b, ",\"available\":");
    sb_str(b, path && *path ? "true" : "false");
    sb_str(b, ",\"path\":");
    sb_quoted(b, path ? path : "");
    sb_str(b, mcp ? ",\"tools\":true" : ",\"tools\":false");
}

static const char *list_providers(void)
{
    struct sb b = {0};
    char path[1024], cwd[1024];
    int first = 1;
    sb_str(&b, "{\"providers\":[");
    const char *fake = fake_provider();
    if (fake) { provider_entry(&b, &first, "fake", "Test provider", fake, 1); sb_str(&b, ",\"models\":[]}"); }
    find_tool("claude", path, sizeof(path));
    provider_entry(&b, &first, "claude", "Claude Code", path, 1);
    sb_str(&b, ",\"models\":[]}");
    find_tool("codex", path, sizeof(path));
    provider_entry(&b, &first, "codex", "Codex", path, 1);
    sb_str(&b, ",\"models\":[]}");
    int have_ollama = find_tool("ollama", path, sizeof(path));
    char *listing = NULL;
    if (have_ollama) {
        char *argv[] = { path, "list", NULL };
        listing = capture(argv, 3000);
    }
    provider_entry(&b, &first, "ollama", "Ollama (local model)", listing ? path : "", 0);
    sb_str(&b, ",\"models\":[");
    if (listing) {
        int count = 0;
        char *save = NULL;
        for (char *line = strtok_r(listing, "\n", &save); line; line = strtok_r(NULL, "\n", &save)) {
            if (strncmp(line, "NAME", 4) == 0) continue;
            char *space = strpbrk(line, " \t");
            if (space) *space = 0;
            if (!*line) continue;
            if (count++) sb_str(&b, ",");
            sb_quoted(&b, line);
        }
        free(listing);
    }
    sb_str(&b, "]}],\"mcpServer\":");
    if (!getcwd(cwd, sizeof(cwd))) cwd[0] = 0;
    char server[1200];
    snprintf(server, sizeof(server), "%s/mcp/flowstudio_mcp.py", cwd);
    sb_quoted(&b, server);
    sb_str(&b, ",\"url\":");
    sb_quoted(&b, fs_origin());
    sb_str(&b, "}");
    return reply_owned(b.data, 200);
}

/* The rules and the verified Flow guide, read fresh for every job. */
static char *system_prompt(void)
{
    char *rules = read_file("mcp/assistant_prompt.md");
    char *guide = read_file("docs/FLOW_FOR_AI.md");
    struct sb b = {0};
    sb_str(&b, rules ? rules : "You are the FlowStudio assistant.\n");
    sb_str(&b, "\n\n# Flow guide\n\n");
    sb_str(&b, guide ? guide : "(docs/FLOW_FOR_AI.md is missing)\n");
    free(rules);
    free(guide);
    return b.data;
}

/* The MCP server command shared by Claude Code and the fake provider. */
static char *mcp_config_json(const char *python, const char *server, int allow_runs)
{
    struct sb b = {0};
    sb_str(&b, "{\"mcpServers\":{\"flowstudio\":{\"type\":\"stdio\",\"command\":");
    sb_quoted(&b, python);
    sb_str(&b, ",\"args\":[");
    sb_quoted(&b, server);
    sb_str(&b, "],\"env\":{\"FLOWSTUDIO_URL\":");
    sb_quoted(&b, fs_origin());
    sb_str(&b, ",\"FLOWSTUDIO_MCP_MODE\":\"assistant\",\"FLOWSTUDIO_MCP_RUN\":");
    sb_quoted(&b, allow_runs ? "flow" : "none");
    sb_str(&b, "}}}}");
    return b.data;
}

#define CLAUDE_TOOLS "mcp__flowstudio__flowstudio_health,mcp__flowstudio__flowstudio_check_code," \
    "mcp__flowstudio__flowstudio_run_code,mcp__flowstudio__flowstudio_flow_help," \
    "mcp__flowstudio__flowstudio_flow_guide,mcp__flowstudio__flowstudio_editor_state," \
    "mcp__flowstudio__flowstudio_propose_edit,mcp__flowstudio__flowstudio_read_workspace_file"

/* argv for one job. Returns a NULL terminated list of owned strings. */
static char **job_argv(const char *provider, const char *tool, const char *model,
                       const char *python, const char *server, const char *system, int allow_runs)
{
    char **argv = calloc(40, sizeof(char *));
    int k = 0;
    if (!argv) return NULL;
    argv[k++] = strdup(tool);
    if (strcmp(provider, "claude") == 0 || strcmp(provider, "fake") == 0) {
        const char *fixed[] = { "-p", "--output-format", "stream-json", "--verbose",
            "--include-partial-messages", "--strict-mcp-config", "--tools", "",
            "--allowedTools", CLAUDE_TOOLS,
            "--disallowedTools", "mcp__flowstudio__flowstudio_write_workspace_file",
            "--permission-mode", "dontAsk", "--no-session-persistence", NULL };
        for (int i = 0; fixed[i]; i++) argv[k++] = strdup(fixed[i]);
        argv[k++] = strdup("--mcp-config");
        argv[k++] = mcp_config_json(python, server, allow_runs);
        argv[k++] = strdup("--append-system-prompt");
        argv[k++] = strdup(system);
        if (model && *model) { argv[k++] = strdup("--model"); argv[k++] = strdup(model); }
    } else if (strcmp(provider, "codex") == 0) {
        const char *fixed[] = { "exec", "--json", "--sandbox", "read-only", "--skip-git-repo-check",
            "--ephemeral", "--ignore-user-config", "--color", "never", NULL };
        for (int i = 0; fixed[i]; i++) argv[k++] = strdup(fixed[i]);
        struct sb c = {0};
        sb_str(&c, "mcp_servers.flowstudio.command=");
        sb_quoted(&c, python);
        argv[k++] = strdup("-c"); argv[k++] = c.data;
        struct sb a = {0};
        sb_str(&a, "mcp_servers.flowstudio.args=[");
        sb_quoted(&a, server);
        sb_str(&a, "]");
        argv[k++] = strdup("-c"); argv[k++] = a.data;
        struct sb e = {0};
        sb_str(&e, "mcp_servers.flowstudio.env={FLOWSTUDIO_URL=");
        sb_quoted(&e, fs_origin());
        sb_str(&e, ",FLOWSTUDIO_MCP_MODE=\"assistant\",FLOWSTUDIO_MCP_RUN=");
        sb_quoted(&e, allow_runs ? "flow" : "none");
        sb_str(&e, "}");
        argv[k++] = strdup("-c"); argv[k++] = e.data;
        argv[k++] = strdup("-c"); argv[k++] = strdup("approval_policy=\"never\"");
        /* Under approval_policy never, MCP calls that need approval fail.
           The FlowStudio tools are pre-approved; the write tool is off. */
        argv[k++] = strdup("-c"); argv[k++] = strdup("mcp_servers.flowstudio.default_tools_approval_mode=\"approve\"");
        argv[k++] = strdup("-c"); argv[k++] = strdup("mcp_servers.flowstudio.disabled_tools=[\"flowstudio_write_workspace_file\"]");
        if (model && *model) { argv[k++] = strdup("--model"); argv[k++] = strdup(model); }
        argv[k++] = strdup("-");
    } else {
        argv[k++] = strdup("run");
        argv[k++] = strdup(model);
        argv[k++] = strdup("--nowordwrap");
        argv[k++] = strdup("--hidethinking");
    }
    argv[k] = NULL;
    return argv;
}

/* ---------- jobs ---------- */
static int remove_entry(const char *path, const struct stat *sb, int flag, struct FTW *ftw)
{
    (void)sb; (void)flag; (void)ftw;
    return remove(path);
}

static long job_timeout_seconds(void)
{
    const char *raw = getenv("FLOWSTUDIO_ASSISTANT_TIMEOUT");
    long value = raw ? strtol(raw, NULL, 10) : 0;
    return value > 0 ? value : 600;
}

static void kill_group(struct as_job *job)
{
    if (job->pid <= 0 || job->exited) return;
    kill(-job->pid, SIGTERM);
    kill(job->pid, SIGTERM);
    int status = 0;
    for (int tries = 0; tries < 40; tries++) {
        if (waitpid(job->pid, &status, WNOHANG) == job->pid) { job->exited = 1; break; }
        usleep(5000);
    }
    if (!job->exited) {
        kill(-job->pid, SIGKILL);
        kill(job->pid, SIGKILL);
        waitpid(job->pid, &status, 0);
        job->exited = 1;
    }
    /* Grandchildren (an MCP server) share the group; make sure they go. */
    kill(-job->pid, SIGKILL);
    job->exit_code = -1;
}

static void release_job(struct as_job *job)
{
    kill_group(job);
    if (job->out_fd > 0) close(job->out_fd);
    if (job->err_fd > 0) close(job->err_fd);
    if (job->dir[0]) nftw(job->dir, remove_entry, 8, FTW_DEPTH | FTW_PHYS);
    memset(job, 0, sizeof(*job));
}

static void reap_job(struct as_job *job)
{
    int status = 0;
    if (job->pid > 0 && !job->exited && waitpid(job->pid, &status, WNOHANG) == job->pid) {
        job->exited = 1;
        job->exit_code = WIFEXITED(status) ? WEXITSTATUS(status) : 128 + (WIFSIGNALED(status) ? WTERMSIG(status) : 0);
    }
}

static void sweep_orphans(void)
{
    time_t now = time(NULL);
    for (int i = 0; i < AS_MAX_JOBS; i++)
        if (jobs[i].id && now - jobs[i].last_seen > AS_ORPHAN_SECONDS) release_job(&jobs[i]);
}

static struct as_job *find_job(const char *body)
{
    long id = body ? strtol(body, NULL, 10) : 0;
    for (int i = 0; i < AS_MAX_JOBS; i++)
        if (id > 0 && jobs[i].id == id) { jobs[i].last_seen = time(NULL); return &jobs[i]; }
    return NULL;
}

static char *next_line(char **cursor)
{
    char *start = *cursor;
    char *nl = strchr(start, '\n');
    if (!nl) return NULL;
    *nl = 0;
    *cursor = nl + 1;
    return start;
}

static const char *start_job(const char *body)
{
    sweep_orphans();
    char *copy = strdup(body ? body : "");
    char *cursor = copy;
    char *provider = next_line(&cursor);
    char *model = provider ? next_line(&cursor) : NULL;
    char *runs = model ? next_line(&cursor) : NULL;
    const char *prompt = cursor;
    if (!runs || !*prompt) { free(copy); return reply_copy("Expected provider, model, runs and a prompt.", 400); }
    int allow_runs = strcmp(runs, "1") == 0;
    char tool[1024], python[1024], cwd[1024], server[1200];
    int known = 1;
    if (strcmp(provider, "fake") == 0) {
        const char *fake = fake_provider();
        snprintf(tool, sizeof(tool), "%s", fake ? fake : "");
    } else if (strcmp(provider, "claude") == 0 || strcmp(provider, "codex") == 0 || strcmp(provider, "ollama") == 0) {
        find_tool(provider, tool, sizeof(tool));
    } else known = 0;
    if (!known) { free(copy); return reply_copy("Unknown assistant provider.", 400); }
    if (!tool[0]) { free(copy); return reply_copy("That assistant is not installed on this machine.", 503); }
    if (strcmp(provider, "ollama") == 0 && (!*model || model[0] == '-')) { free(copy); return reply_copy("Choose an Ollama model first.", 400); }
    if (model[0] == '-') { free(copy); return reply_copy("Invalid model name.", 400); }
    struct as_job *slot = NULL;
    for (int i = 0; i < AS_MAX_JOBS; i++) if (!jobs[i].id) { slot = &jobs[i]; break; }
    if (!slot) { free(copy); return reply_copy("Too many assistant requests are running. Stop one first.", 409); }
    if (!find_tool("python3", python, sizeof(python))) snprintf(python, sizeof(python), "python3");
    if (!getcwd(cwd, sizeof(cwd))) cwd[0] = 0;
    snprintf(server, sizeof(server), "%s/mcp/flowstudio_mcp.py", cwd);

    memset(slot, 0, sizeof(*slot));
    snprintf(slot->dir, sizeof(slot->dir), "/tmp/flowstudio-assistant-XXXXXX");
    if (!mkdtemp(slot->dir)) { slot->dir[0] = 0; free(copy); return reply_copy("Unable to create a private folder.", 500); }
    char *system = system_prompt();
    char prompt_path[160];
    snprintf(prompt_path, sizeof(prompt_path), "%s/prompt.txt", slot->dir);
    int has_tools = strcmp(provider, "ollama") != 0 && strcmp(provider, "codex") != 0;
    struct sb full = {0};
    if (!has_tools) { sb_str(&full, system); sb_str(&full, "\n\n# Request\n\n"); }
    sb_str(&full, prompt);
    int wrote = write_file(prompt_path, full.data ? full.data : "") == 0;
    free(full.data);
    char tool_dir[1024], python_dir[1024];
    dirname_of(tool, tool_dir, sizeof(tool_dir));
    dirname_of(python, python_dir, sizeof(python_dir));
    char **argv = job_argv(provider, tool, model, python, server, system, allow_runs);
    char **envp = child_environment(tool_dir, python_dir, allow_runs);
    free(system);
    int out_pipe[2] = {-1, -1}, err_pipe[2] = {-1, -1};
    int input = wrote ? open(prompt_path, O_RDONLY) : -1;
    if (!argv || !envp || input < 0 || pipe(out_pipe) != 0 || pipe(err_pipe) != 0) {
        free_strings(argv); free_strings(envp);
        if (input >= 0) close(input);
        release_job(slot);
        free(copy);
        return reply_copy("Unable to start the assistant.", 500);
    }
    pid_t pid = fork();
    if (pid == 0) {
        setpgid(0, 0);
        if (chdir(slot->dir) != 0) _exit(126);
        dup2(input, 0);
        dup2(out_pipe[1], 1);
        dup2(err_pipe[1], 2);
        struct rlimit limit;
        int top = (getrlimit(RLIMIT_NOFILE, &limit) == 0 && limit.rlim_cur != RLIM_INFINITY &&
                   limit.rlim_cur < 65536) ? (int)limit.rlim_cur : 4096;
        for (int fd = 3; fd < top; fd++) close(fd);
        signal(SIGPIPE, SIG_DFL);
        signal(SIGCHLD, SIG_DFL);
        execve(argv[0], argv, envp);
        _exit(127);
    }
    close(input);
    close(out_pipe[1]);
    close(err_pipe[1]);
    free_strings(argv);
    free_strings(envp);
    free(copy);
    if (pid < 0) {
        close(out_pipe[0]); close(err_pipe[0]);
        release_job(slot);
        return reply_copy("Unable to start the assistant.", 500);
    }
    setpgid(pid, pid);
    fcntl(out_pipe[0], F_SETFL, O_NONBLOCK);
    fcntl(err_pipe[0], F_SETFL, O_NONBLOCK);
    fcntl(out_pipe[0], F_SETFD, FD_CLOEXEC);
    fcntl(err_pipe[0], F_SETFD, FD_CLOEXEC);
    slot->pid = pid;
    slot->out_fd = out_pipe[0];
    slot->err_fd = err_pipe[0];
    slot->id = next_job_id++;
    slot->started = slot->last_seen = time(NULL);
    char id[24];
    snprintf(id, sizeof(id), "%d", slot->id);
    return reply_copy(id, 200);
}

static void read_stderr(struct as_job *job)
{
    char buf[4096];
    for (;;) {
        ssize_t n = read(job->err_fd, buf, sizeof(buf));
        if (n < 0 && errno == EINTR) continue;
        if (n <= 0) break;
        size_t add = (size_t)n;
        if (add >= AS_TAIL) { memcpy(job->tail, buf + add - AS_TAIL, AS_TAIL); job->tail_len = AS_TAIL; continue; }
        if (job->tail_len + add > AS_TAIL) {
            size_t drop = job->tail_len + add - AS_TAIL;
            memmove(job->tail, job->tail + drop, job->tail_len - drop);
            job->tail_len -= drop;
        }
        memcpy(job->tail + job->tail_len, buf, add);
        job->tail_len += add;
    }
    job->tail[job->tail_len] = 0;
}

static const char *poll_job(const char *body)
{
    struct as_job *job = find_job(body);
    if (!job) return reply_copy("Unknown assistant job.", 404);
    /* Reap before reading, so output written just before exit is drained
       by this same read. */
    reap_job(job);
    struct sb out = {0};
    char buf[16384];
    while (out.len < AS_CHUNK && !job->out_eof) {
        ssize_t n = read(job->out_fd, buf, sizeof(buf));
        if (n > 0) { sb_add(&out, buf, (size_t)n); continue; }
        if (n < 0 && errno == EINTR) continue;
        if (n == 0) job->out_eof = 1;
        break;
    }
    read_stderr(job);
    if (!job->exited && time(NULL) - job->started > job_timeout_seconds()) {
        job->timed_out = 1;
        kill_group(job);
    }
    /* Finished once the process is gone and its output is drained. A
       grandchild that keeps the pipe open does not hold the job. */
    int finished = job->exited && (job->out_eof || out.len < AS_CHUNK);
    struct sb reply = {0};
    char head[48];
    if (!finished) snprintf(head, sizeof(head), "running\n");
    else if (job->cancelled) snprintf(head, sizeof(head), "cancelled\n");
    else if (job->timed_out) snprintf(head, sizeof(head), "timeout\n");
    else snprintf(head, sizeof(head), "exit %d\n", job->exit_code);
    sb_str(&reply, head);
    if (out.data) sb_add(&reply, out.data, out.len);
    free(out.data);
    if (finished) {
        sb_str(&reply, "\x1e");
        sb_str(&reply, job->tail);
        release_job(job);
    }
    return reply_owned(reply.data, 200);
}

static const char *cancel_job(const char *body)
{
    struct as_job *job = find_job(body);
    if (!job) return reply_copy("Unknown assistant job.", 404);
    if (!job->exited) { job->cancelled = 1; kill_group(job); }
    return reply_copy("", 200);
}

/* ---------- editor snapshot and proposals ---------- */
static const char *set_context(const char *body)
{
    if (!body || body[0] != '{' || strlen(body) > AS_CONTEXT_LIMIT)
        return reply_copy("The editor snapshot must be a JSON object of at most 128 KiB.", 400);
    free(context_json);
    context_json = strdup(body);
    return reply_copy("", 200);
}

static const char *add_proposal(const char *body)
{
    if (!body || body[0] != '{' || strlen(body) > AS_CONTEXT_LIMIT)
        return reply_copy("A proposal must be a JSON object of at most 128 KiB.", 400);
    if (proposal_count == AS_MAX_PROPOSALS) {
        free(proposals[0]);
        memmove(proposals, proposals + 1, sizeof(char *) * (AS_MAX_PROPOSALS - 1));
        proposal_count--;
    }
    int id = next_proposal_id++;
    struct sb b = {0};
    char head[48];
    snprintf(head, sizeof(head), "{\"id\":%d,\"proposal\":", id);
    sb_str(&b, head);
    sb_str(&b, body);
    sb_str(&b, "}");
    proposals[proposal_count++] = b.data;
    char reply[24];
    snprintf(reply, sizeof(reply), "%d", id);
    return reply_copy(reply, 200);
}

static const char *take_proposals(void)
{
    struct sb b = {0};
    sb_str(&b, "[");
    for (int i = 0; i < proposal_count; i++) {
        if (i) sb_str(&b, ",");
        sb_str(&b, proposals[i]);
        free(proposals[i]);
        proposals[i] = NULL;
    }
    proposal_count = 0;
    sb_str(&b, "]");
    return reply_owned(b.data, 200);
}

const char *fs_assistant(const char *op, const char *body)
{
    as_status = 400;
    if (!op) return reply_copy("Bad assistant request.", 400);
    if (strcmp(op, "providers") == 0) return list_providers();
    if (strcmp(op, "start") == 0) return start_job(body);
    if (strcmp(op, "poll") == 0) return poll_job(body);
    if (strcmp(op, "cancel") == 0) return cancel_job(body);
    if (strcmp(op, "context-set") == 0) return set_context(body);
    if (strcmp(op, "context-get") == 0) return reply_copy(context_json ? context_json : "{\"empty\":true}", 200);
    if (strcmp(op, "propose") == 0) return add_proposal(body);
    if (strcmp(op, "proposals") == 0) return take_proposals();
    return reply_copy("Unknown assistant operation.", 400);
}
