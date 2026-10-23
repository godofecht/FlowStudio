#include <stdio.h>
#include <string.h>
extern const char *fs_r_run(const char *);
extern int fs_r_status(void);
extern void fs_r_reset(void);
static int failure(int step, const char *output)
{
    fprintf(stderr, "R IPC stage %d failed: HTTP status=%d, output prefix=%.512s\n",
            step, fs_r_status(), output ? output : "(null)");
    return step;
}

int main(void)
{
    const char *out = fs_r_run("value <- 41\ncat(value, '\\n')");
    if (fs_r_status() != 200 || strcmp(out, "41\n") != 0) return failure(1, out);
    out = fs_r_run("value <- value + 1\ncat(value, '\\n')");
    if (fs_r_status() != 200 || strcmp(out, "42\n") != 0) return failure(2, out);
    out = fs_r_run("stop('expected failure')");
    if (fs_r_status() != 422 || !strstr(out, "expected failure")) return failure(3, out);
    out = fs_r_run("cat(value, '\\n')");
    if (fs_r_status() != 200 || strcmp(out, "42\n") != 0) return failure(4, out);
    fs_r_reset();
    out = fs_r_run("cat(exists('value', inherits=FALSE), '\\n')");
    if (fs_r_status() != 200 || strcmp(out, "FALSE\n") != 0) return failure(5, out);
    out = fs_r_run("cat(paste(rep('a', 200000), collapse=''))");
    if (fs_r_status() != 200 || strlen(out) > 131072 ||
        !strstr(out, "[Output truncated]")) return failure(6, out);
    fs_r_reset();
    out = fs_r_run("Sys.sleep(20)");
    if (fs_r_status() != 504 || !strstr(out, "timed out")) return failure(7, out);
    out = fs_r_run("cat('restarted\\n')");
    if (fs_r_status() != 200 || strcmp(out, "restarted\n") != 0) return failure(8, out);
    out = fs_r_run("");
    if (fs_r_status() != 200 || strcmp(out, "(No output)") != 0) return failure(9, out);
    fs_r_reset();
    puts("PASS: native persistent R, exceptions, reset, bounded output, timeout recovery");
    return 0;
}
