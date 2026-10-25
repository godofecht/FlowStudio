#include <stdio.h>
#include <stdlib.h>
#include <string.h>
extern const char *fs_r_run(const char *);
extern const char *fs_r_debug_start(const char *);
extern const char *fs_r_debug_step(void);
extern const char *fs_r_debug_continue(const char *);
extern const char *fs_r_debug_evaluate(const char *);
extern const char *fs_r_debug_stop(void);
extern const char *fs_r_debug_status(void);
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
    /* Cooperative R debugger evaluates real parsed expressions one at a time.
     * Source locations, workspace persistence and ordinary-run exclusion are
     * asserted against the live Rscript process, not a simulated evaluator. */
    out = fs_r_debug_start("debug_value <- 40L\ndebug_value <- debug_value + 2L\ncat(debug_value)");
    if (fs_r_status() != 200 || !strstr(out, "\"state\":\"paused\"") ||
        !strstr(out, "\"next_line\":1") || !strstr(out, "\"total\":3"))
        return failure(68, out);
    out = fs_r_run("debug_value <- 999L");
    if (fs_r_status() != 422 || !strstr(out, "debugger is paused"))
        return failure(69, out);
    out = fs_r_debug_step();
    if (fs_r_status() != 200 || !strstr(out, "\"executed_line\":1") ||
        !strstr(out, "\"next_line\":2")) return failure(70, out);
    out = fs_r_debug_status();
    if (fs_r_status() != 200 || !strstr(out, "\"state\":\"paused\"") ||
        !strstr(out, "\"index\":2")) return failure(71, out);
    /* Real paused-console evaluation does not consume the next expression. */
    out = fs_r_debug_evaluate("debug_value + 2L");
    if (fs_r_status() != 200 || !strstr(out, "\"output\":\"[1] 42") ||
        !strstr(out, "\"state\":\"paused\"") ||
        !strstr(out, "\"index\":2")) return failure(98, out);
    out = fs_r_debug_evaluate("debug_watch <- 99L");
    if (fs_r_status() != 200 || !strstr(out, "\"state\":\"paused\"") ||
        !strstr(out, "\"index\":2")) return failure(99, out);
    out = fs_r_debug_evaluate("stop('watch failure')");
    if (fs_r_status() != 422 || !strstr(out, "watch failure") ||
        !strstr(out, "\"state\":\"paused\"") ||
        !strstr(out, "\"index\":2")) return failure(100, out);
    out = fs_r_debug_evaluate("debug_value <- 999L; debug_value <- 0L");
    if (fs_r_status() != 422 || !strstr(out, "exactly one expression") ||
        !strstr(out, "\"index\":2")) return failure(101, out);
    out = fs_r_debug_evaluate("debug_value <- )");
    if (fs_r_status() != 422 || !strstr(out, "R syntax error") ||
        !strstr(out, "\"index\":2")) return failure(102, out);
    out = fs_r_debug_step();
    if (fs_r_status() != 200 || !strstr(out, "\"next_line\":3"))
        return failure(72, out);
    out = fs_r_debug_step();
    if (fs_r_status() != 200 || !strstr(out, "\"state\":\"done\"") ||
        !strstr(out, "\"output\":\"42\"")) return failure(73, out);
    out = fs_r_debug_step();
    if (fs_r_status() != 422 || !strstr(out, "No paused R expression"))
        return failure(74, out);
    out = fs_r_run("cat(debug_value)");
    if (fs_r_status() != 200 || strcmp(out, "42") != 0)
        return failure(75, out);
    out = fs_r_run("cat(debug_watch)");
    if (fs_r_status() != 200 || strcmp(out, "99") != 0)
        return failure(103, out);
    out = fs_r_debug_evaluate("debug_value");
    if (fs_r_status() != 422 || !strstr(out, "No paused or failed R expression"))
        return failure(104, out);
    out = fs_r_debug_start("debug_value <- )");
    if (fs_r_status() != 422 || !strstr(out, "R syntax error"))
        return failure(76, out);
    out = fs_r_debug_start("debug_value <- 100L\nstop('debug trap')\ncat('must not run')");
    if (fs_r_status() != 200) return failure(77, out);
    out = fs_r_debug_step();
    if (fs_r_status() != 200) return failure(78, out);
    out = fs_r_debug_step();
    if (fs_r_status() != 422 || !strstr(out, "\"state\":\"error\"") ||
        !strstr(out, "debug trap") || !strstr(out, "\"failed_line\":2"))
        return failure(79, out);
    /* Postmortem evaluation reads the real workspace without retrying the
     * failed expression or running the remaining source. */
    out = fs_r_debug_status();
    if (fs_r_status() != 200 || !strstr(out, "\"failed_line\":2") ||
        !strstr(out, "\"state\":\"error\"")) return failure(115, out);
    out = fs_r_debug_evaluate("debug_value + 1L");
    if (fs_r_status() != 200 || !strstr(out, "\"output\":\"[1] 101") ||
        !strstr(out, "\"failed_line\":2") || !strstr(out, "\"state\":\"error\""))
        return failure(116, out);
    out = fs_r_debug_evaluate("postmortem_probe <- debug_value + 2L");
    if (fs_r_status() != 200 || !strstr(out, "\"state\":\"error\""))
        return failure(117, out);
    out = fs_r_debug_evaluate("stop('postmortem evaluation failure')");
    if (fs_r_status() != 422 || !strstr(out, "postmortem evaluation failure") ||
        !strstr(out, "\"failed_line\":2") || !strstr(out, "\"state\":\"error\""))
        return failure(118, out);
    out = fs_r_debug_step();
    if (fs_r_status() != 422 || !strstr(out, "No paused R expression"))
        return failure(119, out);
    out = fs_r_debug_stop();
    if (fs_r_status() != 200 || !strstr(out, "\"state\":\"idle\""))
        return failure(80, out);
    out = fs_r_run("cat(debug_value)");
    if (fs_r_status() != 200 || strcmp(out, "100") != 0)
        return failure(81, out);
    out = fs_r_run("cat(postmortem_probe)");
    if (fs_r_status() != 200 || strcmp(out, "102") != 0)
        return failure(120, out);
    /* A genuine nested user-function error retains lexical frame environments.
     * These are postmortem frames, not active browser() breakpoints.
     * Frame reads/evaluations must never resume the failed source expression. */
    out = fs_r_debug_start(
        "outer <- function(v) { local_outer <- v + 1L; "
        "inner <- function(w) { local_inner <- w + 2L; "
        "stop('nested postmortem failure') }; inner(local_outer) }\n"
        "outer(40L)\ncat('must not run')");
    if (fs_r_status() != 200) return failure(121, out);
    out = fs_r_debug_step();
    if (fs_r_status() != 200) return failure(122, out);
    out = fs_r_debug_step();
    if (fs_r_status() != 422 || !strstr(out, "nested postmortem failure") ||
        !strstr(out, "\\"failed_line\\":2") ||
        !strstr(out, "\\"call\\":\\"outer(40L)\\"") ||
        !strstr(out, "\\"call\\":\\"inner(local_outer)\\"") ||
        !strstr(out, "\\"local_outer\\"") ||
        !strstr(out, "\\"local_inner\\""))
        return failure(123, out);
    out = fs_r_debug_status();
    if (fs_r_status() != 200 || !strstr(out, "\\"frames\\":[{"))
        return failure(124, out);
    out = fs_r_debug_evaluate("@1\nlocal_outer");
    if (fs_r_status() != 200 || !strstr(out, "\\"output\\":\\"[1] 41"))
        return failure(125, out);
    out = fs_r_debug_evaluate("@2\nlocal_inner");
    if (fs_r_status() != 200 || !strstr(out, "\\"output\\":\\"[1] 43"))
        return failure(126, out);
    out = fs_r_debug_evaluate("@2\nlocal_inner <- local_inner + 1L");
    if (fs_r_status() != 200) return failure(127, out);
    out = fs_r_debug_evaluate("@2\nlocal_inner");
    if (fs_r_status() != 200 || !strstr(out, "\\"output\\":\\"[1] 44"))
        return failure(128, out);
    out = fs_r_debug_evaluate("@8\nlocal_inner");
    if (fs_r_status() != 422 || !strstr(out, "No retained R function frame"))
        return failure(129, out);
    out = fs_r_debug_status();
    if (fs_r_status() != 200 || !strstr(out, "\\"failed_line\\":2"))
        return failure(130, out);
    out = fs_r_debug_stop();
    if (fs_r_status() != 200 || !strstr(out, "\\"frames\\":[]"))
        return failure(131, out);
    out = fs_r_debug_evaluate("@2\nlocal_inner");
    if (fs_r_status() != 422) return failure(132, out);
    /* Continue pauses before future top-level expressions and preserves state. */
    out = fs_r_debug_start("continue_value <- 40L\ncontinue_value <- continue_value + 2L\ncat(continue_value)");
    if (fs_r_status() != 200) return failure(82, out);
    out = fs_r_debug_continue("999");
    if (fs_r_status() != 422 || !strstr(out, "No later top-level expression") ||
        !strstr(out, "\"index\":1")) return failure(83, out);
    out = fs_r_debug_continue("0");
    if (fs_r_status() != 422 || !strstr(out, "positive source line"))
        return failure(84, out);
    out = fs_r_debug_continue("3");
    if (fs_r_status() != 200 || !strstr(out, "\"state\":\"paused\"") ||
        !strstr(out, "\"next_line\":3") ||
        !strstr(out, "\"executed_line\":2")) return failure(85, out);
    out = fs_r_run("cat(continue_value)");
    if (fs_r_status() != 422) return failure(86, out);
    out = fs_r_debug_continue("");
    if (fs_r_status() != 200 || !strstr(out, "\"state\":\"done\"") ||
        !strstr(out, "\"output\":\"42\"")) return failure(87, out);
    out = fs_r_run("cat(continue_value)");
    if (fs_r_status() != 200 || strcmp(out, "42") != 0) return failure(88, out);
    /* Multiple top-level breakpoints follow source order, not input order.
     * Reusing the same list resumes to the next future breakpoint. */
    out = fs_r_debug_start("multi <- 0L\nmulti <- multi + 1L\nmulti <- multi + 10L\nmulti <- multi + 100L\ncat(multi)");
    if (fs_r_status() != 200) return failure(92, out);
    out = fs_r_debug_continue("4,2");
    if (fs_r_status() != 200 || !strstr(out, "\"next_line\":2") ||
        !strstr(out, "\"executed_line\":1")) return failure(93, out);
    out = fs_r_debug_continue("2,,4");
    if (fs_r_status() != 422 || !strstr(out, "comma-separated") ||
        !strstr(out, "\"next_line\":2")) return failure(94, out);
    out = fs_r_debug_continue("4,2");
    if (fs_r_status() != 200 || !strstr(out, "\"next_line\":4") ||
        !strstr(out, "\"executed_line\":3")) return failure(95, out);
    out = fs_r_debug_continue("");
    if (fs_r_status() != 200 || !strstr(out, "\"state\":\"done\"") ||
        !strstr(out, "\"output\":\"111\"")) return failure(96, out);
    out = fs_r_run("cat(multi)");
    if (fs_r_status() != 200 || strcmp(out, "111") != 0) return failure(97, out);
    /* Conditional breakpoints use real workspace numeric values. */
    out = fs_r_debug_start("conditional_value <- 0L\nconditional_value <- conditional_value + 1L\nconditional_value <- conditional_value + 1L\ncat(conditional_value)");
    if (fs_r_status() != 200) return failure(105, out);
    out = fs_r_debug_continue("2?conditional_value>=1,3?conditional_value>=1");
    if (fs_r_status() != 200 || !strstr(out, "\"next_line\":3") ||
        !strstr(out, "\"executed_line\":2")) return failure(106, out);
    out = fs_r_debug_evaluate("conditional_value");
    if (fs_r_status() != 200 || !strstr(out, "\"output\":\"[1] 1"))
        return failure(107, out);
    out = fs_r_debug_continue("");
    if (fs_r_status() != 200 || !strstr(out, "\"state\":\"done\"") ||
        !strstr(out, "\"output\":\"2\"")) return failure(108, out);
    out = fs_r_debug_start("conditional_value <- 0L\nconditional_value <- conditional_value + 1L\ncat(conditional_value)");
    if (fs_r_status() != 200) return failure(109, out);
    out = fs_r_debug_continue("2?conditional_value>=NaN");
    if (fs_r_status() != 422 || !strstr(out, "\"index\":1"))
        return failure(110, out);
    out = fs_r_debug_continue("3?conditional_value>=2");
    if (fs_r_status() != 200 || !strstr(out, "\"state\":\"done\"") ||
        !strstr(out, "\"output\":\"1\"")) return failure(111, out);
    out = fs_r_run("makeActiveBinding('conditional_tripwire', function() stop('active binding executed'), environment())");
    if (fs_r_status() != 200) return failure(112, out);
    out = fs_r_debug_start("conditional_value <- 0L\nconditional_value <- conditional_value + 1L\ncat(conditional_value)");
    if (fs_r_status() != 200) return failure(113, out);
    out = fs_r_debug_continue("3?conditional_tripwire>=1");
    if (fs_r_status() != 200 || !strstr(out, "\"state\":\"done\"") ||
        !strstr(out, "\"output\":\"1\"")) return failure(114, out);
    out = fs_r_debug_start("continue_value <- 99L\nstop('continue failure')\ncontinue_value <- 100L");
    if (fs_r_status() != 200) return failure(89, out);
    out = fs_r_debug_continue("");
    if (fs_r_status() != 422 || !strstr(out, "\"state\":\"error\"") ||
        !strstr(out, "continue failure")) return failure(90, out);
    out = fs_r_run("cat(continue_value)");
    if (fs_r_status() != 200 || strcmp(out, "99") != 0) return failure(91, out);
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
