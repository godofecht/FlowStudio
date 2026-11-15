/*
 * Which Flow compiler backends this machine can run, for the backend menu.
 * GET /api/flow/backends answers with JSON:
 *   {"c":{"available":true},"mlir":{"available":false,"reason":"..."}}
 *
 * The check only looks at files, so it costs microseconds and never runs a
 * compiler. It follows the Flow CLI's own search for MLIR tools
 * (tools/flow_cli/toolchain.flow, resolve_llvm_path and check_mlir_deps):
 * LLVM_PATH, then mlir-opt on PATH, then the Homebrew llvm prefix.
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static int executable(const char *dir, const char *name, char *found, size_t cap)
{
    if (!dir || !*dir) return 0;
    snprintf(found, cap, "%s/%s", dir, name);
    return access(found, X_OK) == 0;
}

static int on_path(const char *name, char *found, size_t cap)
{
    const char *path = getenv("PATH");
    if (!path) return 0;
    char dir[1024];
    while (*path) {
        const char *end = strchr(path, ':');
        size_t len = end ? (size_t)(end - path) : strlen(path);
        if (len > 0 && len < sizeof(dir)) {
            memcpy(dir, path, len);
            dir[len] = 0;
            if (executable(dir, name, found, cap)) return 1;
        }
        if (!end) break;
        path = end + 1;
    }
    return 0;
}

static void json_string(char *out, size_t cap, const char *text)
{
    size_t k = 0;
    if (k < cap) out[k++] = '"';
    for (const char *p = text; *p && k + 3 < cap; p++) {
        if (*p == '"' || *p == '\\') out[k++] = '\\';
        out[k++] = (unsigned char)*p < 0x20 ? ' ' : *p;
    }
    if (k < cap) out[k++] = '"';
    out[k < cap ? k : cap - 1] = 0;
}

const char *fs_flow_backends(void)
{
    static char reply[4096];
    char found[1200], flow[1200];
    int have_flow = on_path("flow", flow, sizeof(flow));
    const char *llvm = getenv("LLVM_PATH");
    int have_mlir = executable(llvm, "mlir-opt", found, sizeof(found)) ||
                    on_path("mlir-opt", found, sizeof(found)) ||
                    executable("/opt/homebrew/opt/llvm/bin", "mlir-opt", found, sizeof(found)) ||
                    executable("/usr/local/opt/llvm/bin", "mlir-opt", found, sizeof(found));
    char c_reason[256] = "", mlir_reason[512] = "", tool[1400] = "\"\"";
    if (!have_flow) {
        json_string(c_reason, sizeof(c_reason), "The flow command is not on PATH.");
        json_string(mlir_reason, sizeof(mlir_reason), "The flow command is not on PATH.");
    } else if (!have_mlir) {
        json_string(mlir_reason, sizeof(mlir_reason),
                    "MLIR tools not found. Install LLVM with MLIR (brew install llvm), or run ./flow install in the Flow checkout.");
    } else {
        json_string(tool, sizeof(tool), found);
    }
    snprintf(reply, sizeof(reply),
             "{\"c\":{\"available\":%s%s%s},\"mlir\":{\"available\":%s%s%s,\"tool\":%s}}",
             have_flow ? "true" : "false", have_flow ? "" : ",\"reason\":", have_flow ? "" : c_reason,
             have_flow && have_mlir ? "true" : "false",
             have_flow && have_mlir ? "" : ",\"reason\":", have_flow && have_mlir ? "" : mlir_reason,
             tool);
    return reply;
}
