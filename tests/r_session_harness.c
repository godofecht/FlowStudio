#include <stdio.h>
#include <stdlib.h>
#include <string.h>
extern const char *fs_r_run(const char *);
extern const char *fs_r_check(const char *);
extern const char *fs_r_inspect(void);
extern const char *fs_r_table(const char *);
extern const char *fs_r_plot(void);
extern const char *fs_r_packages(void);
extern const char *fs_r_load_package(const char *);
extern const char *fs_r_install_package(const char *);
extern const char *fs_r_remove_package(const char *);
extern const char *fs_r_update_package(const char *);
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
    const char *out = fs_r_run("value <- 41\ncat(value, '\\n', sep='')");
    if (fs_r_status() != 200 || strcmp(out, "41\n") != 0) return failure(1, out);
    /* Real R library inventory is read-only, bounded and uses the same kernel. */
    out = fs_r_packages();
    if (fs_r_status() != 200 || !strstr(out, "\"packages\":[") ||
        !strstr(out, "\"name\":\"stats\"") ||
        !strstr(out, "\"truncated\":") || strlen(out) > 65000)
        return failure(37, out);
    /* Load an installed recommended package in the persistent R search path.
     * Invalid expressions and absent packages must not execute source or kill R.
     */
    out = fs_r_run("cat('package:splines' %in% search())");
    if (fs_r_status() != 200 || strcmp(out, "FALSE") != 0) return failure(38, out);
    out = fs_r_load_package("splines");
    if (fs_r_status() != 200 || !strstr(out, "Loaded installed R package splines"))
        return failure(39, out);
    out = fs_r_run("cat('package:splines' %in% search())");
    if (fs_r_status() != 200 || strcmp(out, "TRUE") != 0) return failure(40, out);
    out = fs_r_load_package("splines;stop('unsafe')");
    if (fs_r_status() != 422 || !strstr(out, "Invalid R package name"))
        return failure(41, out);
    out = fs_r_load_package("FlowStudioPackageDefinitelyMissing");
    if (fs_r_status() != 422 || !strstr(out, "there is no package"))
        return failure(42, out);
    /* Offline native install acceptance: installed base package does not
     * download; malicious expressions cannot reach R's evaluator. */
    out = fs_r_install_package("stats");
    if (fs_r_status() != 200 || !strstr(out, "already installed"))
        return failure(44, out);
    out = fs_r_install_package("stats;system('false')");
    if (fs_r_status() != 422 || !strstr(out, "Invalid R package name"))
        return failure(45, out);
    /* System packages and injected expressions must not be removed. */
    out = fs_r_remove_package("stats");
    if (fs_r_status() != 422 || !strstr(out, "system packages cannot be removed"))
        return failure(49, out);
    out = fs_r_remove_package("stats;system('false')");
    if (fs_r_status() != 422 || !strstr(out, "Invalid R package name"))
        return failure(51, out);
    /* Updates cannot modify system libraries or evaluate expressions. */
    out = fs_r_update_package("stats");
    if (fs_r_status() != 422 || !strstr(out, "system packages cannot be updated"))
        return failure(56, out);
    out = fs_r_update_package("stats;system('false')");
    if (fs_r_status() != 422 || !strstr(out, "Invalid R package name"))
        return failure(57, out);
    out = fs_r_update_package("FlowStudioPackageDefinitelyMissing");
    if (fs_r_status() != 422 || !strstr(out, "not installed in the FlowStudio user library"))
        return failure(58, out);
    out = fs_r_run("cat(value)");
    if (fs_r_status() != 200 || strcmp(out, "41") != 0) return failure(43, out);
    /* Parsing valid source must not evaluate assignments or errors. */
    out = fs_r_check("value <- 999; stop('must not run')");
    if (fs_r_status() != 200 || !strstr(out, "not executed")) return failure(21, out);
    /* Invalid R grammar returns HTTP 422, but leaves the kernel alive. */
    out = fs_r_check("value <- )");
    if (fs_r_status() != 422 || !strstr(out, "R syntax error:") ||
        !strstr(out, "<text>:")) return failure(22, out);
    out = fs_r_run("cat(value, '\\n', sep='')");
    if (fs_r_status() != 200 || strcmp(out, "41\n") != 0) return failure(23, out);
    out = fs_r_inspect();
    if (fs_r_status() != 200 || !strstr(out, "\"name\":\"value\"") ||
        !strstr(out, "\"type\":\"double\"") ||
        !strstr(out, "\"size\":1")) return failure(10, out);
    out = fs_r_run("matrix_value <- matrix(1:6, nrow=2)\ndelayedAssign('broken', stop('forced promise'), assign.env=workspace)");
    if (fs_r_status() != 200) return failure(14, out);
    out = fs_r_inspect();
    if (fs_r_status() != 200 ||
        !strstr(out, "\"name\":\"matrix_value\",\"type\":\"integer\",\"size\":6,\"dimensions\":[2,3]") ||
        !strstr(out, "\"name\":\"broken\",\"type\":\"unavailable\",\"size\":null,\"dimensions\":null"))
        return failure(15, out);
    /* Table snapshots are real values from the same persistent R workspace. */
    out = fs_r_run("native_table <- data.frame(label=c('alpha', 'beta'), "
                   "score=c(42L, NA_integer_), "
                   "group=factor(c('one', 'two')))\n"
                   "native_matrix <- matrix(1:6, nrow=2)");
    if (fs_r_status() != 200) return failure(24, out);
    out = fs_r_table("native_table");
    if (fs_r_status() != 200 ||
        !strstr(out, "\"columns\":[\"label\",\"score\",\"group\"]") ||
        !strstr(out, "[\"alpha\",\"42\",\"one\"]") ||
        !strstr(out, "[\"beta\",\"\",\"two\"]") ||
        !strstr(out, "\"totalRows\":2") ||
        !strstr(out, "\"truncated\":false")) return failure(25, out);
    out = fs_r_table("native_matrix");
    if (fs_r_status() != 200 ||
        !strstr(out, "[\"1\",\"3\",\"5\"]") ||
        !strstr(out, "[\"2\",\"4\",\"6\"]")) return failure(26, out);
    out = fs_r_table("native_table;stop('unsafe')");
    if (fs_r_status() != 422 || !strstr(out, "Invalid R table name"))
        return failure(27, out);
    out = fs_r_table("value");
    if (fs_r_status() != 422 || !strstr(out, "plain data.frame or atomic matrix"))
        return failure(28, out);
    out = fs_r_run("large_table <- data.frame(n=seq_len(300))");
    if (fs_r_status() != 200) return failure(29, out);
    out = fs_r_table("large_table");
    if (fs_r_status() != 200 || !strstr(out, "\"totalRows\":300") ||
        !strstr(out, "\"truncated\":true") || strlen(out) > 65000)
        return failure(30, out);
    out = fs_r_run("makeActiveBinding('unsafe_table', function() "
                   "stop('table binding executed'), workspace)");
    if (fs_r_status() != 200) return failure(31, out);
    out = fs_r_table("unsafe_table");
    if (fs_r_status() != 422 || !strstr(out, "active binding") ||
        strstr(out, "table binding executed")) return failure(32, out);
    /* Real graphics must be captured by the persistent R kernel, not faked. */
    out = fs_r_run("plot(c(1, 2, 3), main='FlowStudio native SVG')");
    if (fs_r_status() != 200) return failure(33, out);
    out = fs_r_plot();
    if (fs_r_status() != 200 ||
        !((strstr(out, "\"svg\":\"<?xml") && strstr(out, "<svg") &&
           strstr(out, "</svg>")) || strstr(out, "\"pdf\":\"25504446")))
        return failure(34, out);
    out = fs_r_run("cat('no plot\\n')");
    if (fs_r_status() != 200) return failure(35, out);
    out = fs_r_plot();
    if (fs_r_status() != 200 || !strstr(out, "\"svg\":null") ||
        !strstr(out, "\"pdf\":null")) return failure(36, out);
    /* Native R lists expose nested metadata without evaluating user methods. */
    out = fs_r_run("nested <- list(numbers=list(answer=42L, more=list(x=1L)), words=c('a','b'))\n"
                   "trap <- structure(list(secret=1L), class='flowstudio_trap')\n"
                   "`[[.flowstudio_trap` <- function(...) stop('user method executed')");
    if (fs_r_status() != 200) return failure(17, out);
    out = fs_r_inspect();
    if (fs_r_status() != 200 ||
        !strstr(out, "\"name\":\"nested\",\"type\":\"list\",\"size\":2") ||
        !strstr(out, "\"name\":\"[[1]] numbers\",\"type\":\"list\",\"size\":2") ||
        !strstr(out, "\"name\":\"[[1]] answer\",\"type\":\"integer\",\"size\":1") ||
        !strstr(out, "\"name\":\"trap\",\"type\":\"list\",\"size\":null,\"dimensions\":null}") ||
        strstr(out, "user method executed")) return failure(18, out);
    out = fs_r_run("large_nested <- replicate(30, as.list(1:30), simplify=FALSE)");
    if (fs_r_status() != 200) return failure(19, out);
    out = fs_r_inspect();
    if (fs_r_status() != 200 || !strstr(out, "\"name\":\"large_nested\"") ||
        !strstr(out, "\"truncated\":true") || strlen(out) > 65000)
        return failure(20, out);
    /* Failed lazy binding must not crash the R kernel or lose prior state. */
    out = fs_r_run("cat(value, '\\n', sep='')");
    if (fs_r_status() != 200 || strcmp(out, "41\n") != 0) return failure(16, out);
    out = fs_r_run("value <- value + 1\ncat(value, '\\n', sep='')");
    if (fs_r_status() != 200 || strcmp(out, "42\n") != 0) return failure(2, out);
    out = fs_r_run("stop('expected failure')");
    if (fs_r_status() != 422 || !strstr(out, "expected failure")) return failure(3, out);
    /* Real nested R errors must preserve user call frames before unwinding,
     * without killing the persistent interpreter or executing a traceback. */
    out = fs_r_run("outer <- function() inner(); "
                   "inner <- function() stop('nested failure'); outer()");
    if (fs_r_status() != 422 || !strstr(out, "nested failure") ||
        !strstr(out, "R call stack (most recent last):") ||
        !strstr(out, "outer()") || !strstr(out, "inner()"))
        return failure(66, out);
    out = fs_r_run("cat(value)");
    if (fs_r_status() != 200 || strcmp(out, "42") != 0)
        return failure(67, out);
    out = fs_r_run("cat(value, '\\n', sep='')");
    if (fs_r_status() != 200 || strcmp(out, "42\n") != 0) return failure(4, out);
    out = fs_r_run("makeActiveBinding('danger', function() stop('inspection executed binding'), environment())");
    if (fs_r_status() != 200) return failure(11, out);
    out = fs_r_inspect();
    if (fs_r_status() != 200 || !strstr(out, "\"name\":\"danger\"") ||
        !strstr(out, "\"type\":\"active binding\"")) return failure(12, out);
    /* Actual fresh-package installation from an offline CRAN-style source
     * repository. The Python harness creates the tarball and PACKAGES index. */
    if (getenv("FLOWSTUDIO_R_TEST_REPO"))
    {
        out = fs_r_install_package("FlowStudioFixture");
        if (fs_r_status() != 200 || !strstr(out, "Installed R package FlowStudioFixture"))
            return failure(46, out);
        out = fs_r_run("cat(FlowStudioFixture::answer())");
        if (fs_r_status() != 200 || strcmp(out, "42") != 0)
            return failure(47, out);
        out = fs_r_update_package("FlowStudioFixture");
        if (fs_r_status() != 422 || !strstr(out, "loaded in the native session"))
            return failure(59, out);
    }
    fs_r_reset();
    out = fs_r_inspect();
    if (fs_r_status() != 200 || !strstr(out, "\"variables\":[]")) return failure(13, out);
    if (getenv("FLOWSTUDIO_R_TEST_REPO"))
    {
        /* Atomically publish the newer CRAN index only after the old version
         * has been installed; both tarballs were built by the Python harness. */
        const char *next = getenv("FLOWSTUDIO_R_TEST_PACKAGES_NEXT");
        const char *current = getenv("FLOWSTUDIO_R_TEST_PACKAGES_CURRENT");
        if (!next || !current || rename(next, current) != 0)
            return failure(60, "Could not publish upgraded offline CRAN index");
        out = fs_r_update_package("FlowStudioFixture");
        if (fs_r_status() != 200 || !strstr(out, "from 0.0.1 to 0.0.2"))
            return failure(61, out);
        out = fs_r_run("cat(FlowStudioFixture::answer())");
        if (fs_r_status() != 200 || strcmp(out, "43") != 0)
            return failure(62, out);
        out = fs_r_update_package("FlowStudioFixture");
        if (fs_r_status() != 422 || !strstr(out, "loaded in the native session"))
            return failure(63, out);
        fs_r_reset();
        out = fs_r_update_package("FlowStudioFixture");
        if (fs_r_status() != 200 || !strstr(out, "up to date at 0.0.2"))
            return failure(64, out);
        out = fs_r_run("cat(FlowStudioFixture::answer())");
        if (fs_r_status() != 200 || strcmp(out, "43") != 0)
            return failure(65, out);
    }
    if (getenv("FLOWSTUDIO_R_TEST_REPO"))
    {
        /* The fixture was loaded through :: above; reset is required to
         * unload its namespace before removal. */
        out = fs_r_remove_package("FlowStudioFixture");
        if (fs_r_status() != 422 || !strstr(out, "loaded in the native session"))
            return failure(52, out);
        fs_r_reset();
        out = fs_r_remove_package("FlowStudioFixture");
        if (fs_r_status() != 200 || !strstr(out, "Removed R package FlowStudioFixture"))
            return failure(53, out);
        out = fs_r_run("cat(requireNamespace('FlowStudioFixture', quietly=TRUE))");
        if (fs_r_status() != 200 || strcmp(out, "FALSE") != 0)
            return failure(54, out);
        out = fs_r_remove_package("FlowStudioFixture");
        if (fs_r_status() != 422 || !strstr(out, "not installed in the FlowStudio user library"))
            return failure(55, out);
    }
    out = fs_r_run("cat(exists('value', inherits=FALSE), '\\n', sep='')");
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
    puts("PASS: native persistent R, nonexecuting syntax checks, environment inspection, active bindings, exceptions, reset, bounded output, timeout recovery");
    return 0;
}
