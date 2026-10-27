#include <stdio.h>
#include <string.h>
extern const char *fs_py_run(const char *);
extern const char *fs_py_inspect(void);
extern const char *fs_py_trace(const char *);
extern int fs_py_status(void);
extern void fs_py_reset(void);
int main(void)
{
    const char *a = fs_py_run("value = 41\nprint(value)");
    if (fs_py_status() != 200 || strcmp(a, "41\n") != 0) return 1;
    a = fs_py_run("value += 1\nprint(value)");
    if (fs_py_status() != 200 || strcmp(a, "42\n") != 0) return 2;
    a = fs_py_run("raise ValueError('bad')");
    if (fs_py_status() != 422 || !strstr(a, "ValueError: bad")) return 3;
    a = fs_py_run("print(value)");
    if (fs_py_status() != 200 || strcmp(a, "42\n") != 0) return 4;
    a = fs_py_inspect();
    if (fs_py_status() != 200 || !strstr(a, "\"name\":\"value\"") ||
        !strstr(a, "\"type\":\"int\"")) return 9;
    a = fs_py_run("class Dangerous:\n    def __repr__(self):\n        globals()['inspected'] = True\n        return 'bad'\nobj = Dangerous()\ninspected = False");
    if (fs_py_status() != 200) return 10;
    a = fs_py_inspect();
    if (fs_py_status() != 200 || !strstr(a, "\"name\":\"obj\"")) return 11;
    a = fs_py_run("print(inspected)");
    if (fs_py_status() != 200 || strcmp(a, "False\n") != 0) return 12;
    a = fs_py_trace("trace_value = value + 1\nprint(trace_value)");
    if (fs_py_status() != 200 || !strstr(a, "\"events\":") ||
        !strstr(a, "\"line\":2") || !strstr(a, "\"output\":\"43")) return 14;
    a = fs_py_run("print(trace_value)");
    if (fs_py_status() != 200 || strcmp(a, "43\n") != 0) return 15;
    a = fs_py_trace("raise ValueError('trace failure')");
    if (fs_py_status() != 422 || !strstr(a, "ValueError: trace failure")) return 16;
    fs_py_reset();
    a = fs_py_inspect();
    if (fs_py_status() != 200 || strstr(a, "\"name\":\"value\"")) return 13;
    a = fs_py_run("print('value' in globals())");
    if (fs_py_status() != 200 || strcmp(a, "False\n") != 0) return 5;
    a = fs_py_run("print('a' * 200000)");
    if (fs_py_status() != 200 || strlen(a) > 131072 || !strstr(a, "[Output truncated]")) return 6;
    fs_py_reset();
    a = fs_py_run("while True: pass");
    if (fs_py_status() != 504 || !strstr(a, "timed out")) return 7;
    a = fs_py_run("print('restarted')");
    if (fs_py_status() != 200 || strcmp(a, "restarted\n") != 0) return 8;
    fs_py_reset();
    puts("PASS: native persistent Python session, errors, reset, output cap, timeout recovery");
    return 0;
}
