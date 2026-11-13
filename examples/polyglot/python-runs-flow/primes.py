# Python runs a Flow kernel. fs.flow() compiles a Flow program and returns
# what it printed. The Flow program reads its input back from this Python
# session with py(), so no files or command lines are involved.
import time
import flowstudio as fs

limit = 2_000_000

KERNEL = """
import flowstudio { py_int, fmt_int }

function main() -> i32 {
    let limit: i64 = py_int("limit")
    let mut count: i64 = 0
    let mut n: i64 = 2
    while n < limit {
        let mut prime: bool = true
        let mut d: i64 = 2
        while d * d <= n {
            if n % d == 0 {
                prime = false
                d = n
            }
            d = d + 1
        }
        if prime {
            count = count + 1
        }
        n = n + 1
    }
    println(fmt_int(count))
    return 0
}
"""

start = time.perf_counter()
flow_count = int(fs.flow(KERNEL))
flow_seconds = time.perf_counter() - start


def count_primes(limit):
    count = 0
    for n in range(2, limit):
        d = 2
        while d * d <= n:
            if n % d == 0:
                break
            d += 1
        else:
            count += 1
    return count


start = time.perf_counter()
python_count = count_primes(limit // 10)
python_seconds = (time.perf_counter() - start) * 10   # scaled estimate

print(f"primes below {limit:,}: {flow_count:,}")
print(f"Flow, compile and run: {flow_seconds:.2f} s")
print(f"pure Python (estimated from a tenth of the range): {python_seconds:.2f} s")
