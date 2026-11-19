#include <stdint.h>
#include <unistd.h>
#include <limits.h>

/* Flow's compiler declares the POSIX length/result as i64. wasm32 uses i32. */
int64_t flowstudio_wasm_write(int32_t fd, const char* buffer, int64_t length) {
    if (length < 0 || length > INT_MAX) return -1;
    return (int64_t)write(fd, buffer, (size_t)length);
}
