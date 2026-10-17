/* Test-only router for the exact production C transport. */
#include <stdio.h>
#include <string.h>
#include <unistd.h>

int fs_listen(int port);
int fs_read_request(int listener);
int fs_intent_allowed(void);
const char *fs_method(void);
const char *fs_path(void);
const char *fs_body(void);
void fs_reply(int status, const char *content_type, const char *body);

int main(void)
{
    int fd = fs_listen(8751);
    if (fd < 0) return 1;
    puts("READY");
    fflush(stdout);
    for (;;)
    {
        if (!fs_read_request(fd)) continue;
        if (strcmp(fs_method(), "GET") == 0 && strcmp(fs_path(), "/health") == 0)
        {
            fs_reply(200, "text/plain", "healthy");
        }
        else if (strcmp(fs_method(), "GET") == 0 &&
                 strcmp(fs_path(), "/status/422") == 0)
        {
            fs_reply(422, "text/plain", "execution failed");
        }
        else if (strcmp(fs_method(), "GET") == 0 &&
                 strcmp(fs_path(), "/status/503") == 0)
        {
            fs_reply(503, "text/plain", "interpreter unavailable");
        }
        else if (strcmp(fs_method(), "GET") == 0 &&
                 strcmp(fs_path(), "/status/504") == 0)
        {
            fs_reply(504, "text/plain", "execution timed out");
        }
        else if (strcmp(fs_method(), "POST") == 0 &&
                 strcmp(fs_path(), "/api/run/python") == 0 && fs_intent_allowed())
        {
            fs_reply(200, "text/plain", fs_body());
        }
        else
        {
            fs_reply(404, "text/plain", "not found");
        }
    }
}
