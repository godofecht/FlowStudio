#include <stdio.h>
#include <string.h>
extern const char *fs_py_run(const char *);
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
    fs_py_reset();
    a = fs_py_run("print('value' in globals())");
    if (fs_py_status() != 200 || strcmp(a, "False\n") != 0) return 5;
    a = fs_py_run("print('a' * 200000)");
    if (fs_py_status() != 200 || strlen(a) > 131072 || !strstr(a, "[Output truncated]")) return 6;
    fs_py_reset();
    puts("PASS: native persistent Python session, errors, reset, output cap");
    return 0;
}
