# Flow for AI assistants

A compact guide to writing Flow that compiles. Every `flow` block in this
file is compiled and run by `tests/test_flow_for_ai.py`, and every `output`
block is the exact output of the block above it. Blocks marked `flow check`
are type checked only, because they need FlowStudio or a window. Blocks
marked `flow error` must fail with the error shown.

Flow is a statically typed language that compiles to C and then to a native
program. It looks a little like Rust or Swift, but it is smaller. When you
are unsure whether a construct exists, write the plain form shown here.

## Working loop

1. Write the whole program, with `function main() -> i32` returning `0`.
2. Check it: `flowstudio_check_code` with language `flow`. This parses and
   type checks without running.
3. Run it: `flowstudio_run_code` with language `flow`. The check does not
   catch every error. Some mistakes only fail when the C compiler builds the
   program, and a run finds those.
4. Fix every error and repeat until both pass. Never present Flow code you
   have not checked.

Graphics programs (they import `stdlib/gfx.flow`) open a window, so check
them and do not run them.

## Program shape

```flow
# Comments start with a hash. There are no // or /* */ comments.
function square(n: i32) -> i32 {
    return n * n
}

function main() -> i32 {
    println("square of 7 is", square(7))
    return 0
}
```

```output
square of 7 is 49
```

- `function`, never `fn` or `def`. Blocks use braces. No semicolons.
- `main` must be declared `-> i32` and return a value.
- A function that returns a value must declare its return type.

## Variables and types

```flow
const LIMIT: i32 = 3
let mut calls: i32 = 0

function main() -> i32 {
    let a: i32 = 7
    let mut total: f64 = 0.0
    let b = 2.5
    let name = "Ada"
    let ok: bool = a > 1
    let big: i64 = 3000000000
    total = total + b
    calls = calls + 1
    println(a, total, name, ok, big, LIMIT, calls)
    return 0
}
```

```output
7 2.500000 Ada 1 3000000000 3 1
```

- `let` is immutable. Use `let mut` for anything you assign later.
- Types: `i8 i16 i32 i64 u8 u16 u32 u64 f32 f64 bool string void`.
- Annotate types. Inference works (`let b = 2.5`), but annotations keep
  integer and float types explicit and make errors clearer.
- `const` and top level `let mut` are module level. The initializer must be
  a constant.
- Convert with `as`: `n as f64`, `(x * 10.0) as i32`. An `as i32` cast
  truncates toward zero.
- Integer division truncates: `7 / 2` is `3`. Use `%` for the remainder.
- `+=`, `-=`, `*=` and `/=` work.

## Printing

```flow
function main() -> i32 {
    let n: i32 = 7
    let x: f64 = 2.5
    println("n =", n, "x =", x)
    println("joined: " + n + " and " + x)
    printf("%d %.3f %s\n", n, x, "text")
    print("no newline")
    print("\n")
    return 0
}
```

```output
n = 7 x = 2.500000
joined: 7 and 2.500000
7 2.500 text
no newline
```

- `println` takes several arguments and separates them with one space.
- Floats print with six decimals. For other formats use `printf` with C
  format strings: `%d` for i32, `%lld` for i64, `%f` or `%.2f` for f64,
  `%s` for strings.
- `bool` prints as `1` or `0`.
- `println(xs)` on an array prints a pointer address. Loop over the
  elements and print each one.

## Control flow

```flow
function classify(n: i32) -> string {
    if n < 0 {
        return "negative"
    } elif n == 0 {
        return "zero"
    } else {
        return "positive"
    }
}

function main() -> i32 {
    for i in 0 to 10 step 3 {
        print(i)
        print(" ")
    }
    println("")
    let mut k: i32 = 0
    while true {
        k = k + 1
        if k == 2 {
            continue
        }
        if k > 4 {
            break
        }
    }
    let sign: i32 = if k > 3 { 1 } else { -1 }
    println(k, sign, classify(-3), classify(0))
    return 0
}
```

```output
0 3 6 9 
5 1 negative zero
```

- `for i in a to b` counts from `a` up to `b - 1`. `a..b` means the same.
  Add `step s` for other strides.
- There is no `for x in array`. Loop over indices.
- `else if` is spelled `elif`.
- An `if` used as a value needs an `else` and single expression arms.

`match` works on integers and enum tags. `_` is the default arm.

```flow
enum Shape {
    Circle,
    Square
}

function sides(s: Shape) -> i32 {
    match s.tag {
        Shape_Circle => { return 0 }
        Shape_Square => { return 4 }
    }
    return -1
}

function describe(n: i32) -> string {
    match n {
        0 => { return "zero" }
        1 => { return "one" }
        _ => { return "many" }
    }
    return ""
}

function main() -> i32 {
    let s: Shape = Shape { tag: Shape_Square }
    println(sides(s), describe(1), describe(9))
    return 0
}
```

```output
4 one many
```

- An enum value is a struct with a `tag`. Variants are named
  `Enum_Variant`. Alternation patterns like `1 | 2 =>` do not parse.

## Functions, pointers and lambdas

```flow
struct Point {
    x: f64,
    y: f64
}

function norm2(p: Point) -> f64 {
    return p.x * p.x + p.y * p.y
}

function shift(p: ptr<Point>, dx: f64) -> void {
    p.x = p.x + dx
}

function report(x: i32) -> void {
    if x < 0 {
        println("negative")
        return
    }
    println("ok", x)
}

function apply(f: (i32) -> i32, x: i32) -> i32 {
    return f(x)
}

function main() -> i32 {
    let mut p: Point = Point { x: 3.0, y: 4.0 }
    println(norm2(p))
    shift(&p, 10.0)
    println(p.x, p.y)
    report(-1)
    report(6)
    let n: i32 = 5
    let add_n: (i32) -> i32 = |x: i32| -> i32 { return x + n }
    println(add_n(10), apply(add_n, 1))
    return 0
}
```

```output
25.000000
13.000000 4.000000
negative
ok 6
15 6
```

- Structs and numbers are passed by value. To change a caller's value, take
  `ptr<T>` and pass `&value` from a `let mut` binding. Fields of a pointer
  are reached with `.` as usual.
- Function types are written `(i32) -> i32`. Lambdas capture by value.
- `impl` blocks and method calls (`c.next()`) are not reliable. Write
  plain functions that take the struct or a pointer to it.

## Arrays and spans

```flow
function mean(xs: span<f64>) -> f64 {
    let mut total: f64 = 0.0
    for i in 0 to xs.len {
        total = total + xs[i]
    }
    return total / (xs.len as f64)
}

function fill_squares(xs: span<mut i32>) -> void {
    for i in 0 to xs.len {
        xs[i] = i * i
    }
}

function main() -> i32 {
    let data: array<f64, 5> = [2.0, 4.0, 4.0, 5.0, 7.0]
    println("mean", mean(data))
    println("first two", mean(data[0..2]))

    let mut squares: array<i32, 6> = [0]
    fill_squares(squares)
    for i in 0 to 6 {
        print(squares[i])
        print(" ")
    }
    println("")

    let n: i32 = 3
    let mut grid: array<f64, 9> = [0.0]
    for row in 0 to n {
        for col in 0 to n {
            grid[row * n + col] = (row * 10 + col) as f64
        }
    }
    println(grid[5])
    return 0
}
```

```output
mean 4.400000
first two 3.000000
0 1 4 9 16 25 
12.000000
```

- Use fixed size arrays: `array<T, N>` with a literal. `[0]` or `[0.0]`
  fills the whole array with zeros.
- Dynamic array literals such as `let xs: array<f64> = [1.0, 2.0]` pass the
  check but fail to build. Give the size: `array<f64, 2>`.
- There is no `length()`, `len()` or `push()` for arrays. Keep the size in a
  constant, or pass a span and read `.len`.
- `span<T>` is a read only view and `span<mut T>` a writable one. An array
  or a slice `xs[a..b]` converts to a span at the call.
- Store a 2D grid in one array indexed `row * n + col`.
- Arrays of structs work: `ps[i].x = ps[i].x + ps[i].v`.

For a size known only at run time, allocate with C `malloc`:

```flow
extern {
    function malloc(n: i64) -> ptr<f64>
    function free(p: ptr<f64>) -> void
}

function main() -> i32 {
    let n: i32 = 5
    let xs: ptr<f64> = malloc((n as i64) * 8)
    for i in 0 to n {
        xs[i] = (i as f64) * 0.5
    }
    let mut total: f64 = 0.0
    for i in 0 to n {
        total = total + xs[i]
    }
    println("total", total)
    free(xs)
    return 0
}
```

```output
total 5.000000
```

## Strings

```flow
import std.string { str_parse_i64, ParseI64 }

extern {
    function strlen(s: string) -> i64
    function snprintf(buf: string, n: i64, fmt: string, ...) -> i32
    function malloc(n: i64) -> string
}

function fmt2(x: f64) -> string {
    let buf: string = malloc(32)
    snprintf(buf, 32, "%.2f", x)
    return buf
}

function main() -> i32 {
    let s: string = "hello"
    let t: string = s + ", " + "world"
    println(t, strlen(t))
    if s == "hello" {
        println("equal")
    }
    let second: u8 = (s as ptr<u8>)[1]
    println(second)
    let parsed: ParseI64 = str_parse_i64("1234")
    println(parsed.ok, parsed.value)
    println("pi is about " + fmt2(3.14159))
    return 0
}
```

```output
hello, world 12
equal
101
1 1234
pi is about 3.14
```

- `+` joins strings, and also joins a string with a number.
- `==` compares string contents.
- C functions are declared in an `extern { }` block and then called
  directly.

## Structs

```flow
struct Particle {
    x: f64,
    v: f64
}

struct Person {
    name: string,
    age: i32
}

function step(p: Particle, dt: f64) -> Particle {
    return Particle { x: p.x + p.v * dt, v: p.v }
}

function main() -> i32 {
    let mut ps: array<Particle, 2> = [Particle { x: 0.0, v: 1.0 }, Particle { x: 1.0, v: -2.0 }]
    for i in 0 to 2 {
        ps[i] = step(ps[i], 0.5)
    }
    println(ps[0].x, ps[1].x)
    let ada: Person = Person { name: "Ada", age: 36 }
    println(ada.name + " is " + ada.age)
    return 0
}
```

```output
0.500000 0.000000
Ada is 36
```

## Systems that evolve

A `flow` block declares state and how it changes over time. The compiler
generates `Name_new()` and `Name_step(&system, dt)`.

```flow
flow Decay {
    state value : f64 = 1.0
    param rate  : f64 = 0.5

    value evolves as -rate * value
}

function main() -> i32 {
    let mut system: Decay = Decay_new()
    for i in 0 to 100 {
        Decay_step(&system, 0.01)
    }
    println(system.value)
    return 0
}
```

```output
0.605770
```

## Standard library

Math functions are built in for `f64`: `sqrt sin cos tan exp log pow fabs
floor ceil round tanh atan2`, and `abs` for integers. `min` and `max` are
not available in a build. Write them:

```flow
function max_f64(a: f64, b: f64) -> f64 {
    if a > b {
        return a
    }
    return b
}

function main() -> i32 {
    let y: f64 = sqrt(2.0) + pow(2.0, 10.0) + floor(2.7)
    println(y, abs(-4), max_f64(1.5, 0.5))
    return 0
}
```

```output
1027.414214 4 1.500000
```

Files, through `std.io`:

```flow
import std.io { FileRead, io_read_text, io_write_file }

function main() -> i32 {
    let wrote: bool = io_write_file("/tmp/flow_for_ai_example.txt", "a,b\n1,2\n")
    let file: FileRead = io_read_text("/tmp/flow_for_ai_example.txt")
    if file.ok {
        print(file.data)
    }
    println(wrote)
    return 0
}
```

```output
a,b
1,2
1
```

Other modules: `std.string` (parsing and formatting), `std.process`
(running programs), `std.os` (errno and signals). Import named symbols:
`import std.io { io_read_text }`. Older code imports by path:
`import "stdlib/gfx.flow"`.

## FlowStudio: calling Python and R

In FlowStudio, a Flow program can call the live Python and R sessions.
Each call returns the value of the last expression as text: one item per
line, a data frame as CSV.

```flow check
import flowstudio { py, r, py_num, r_num, py_int, fmt, fmt_int }

function main() -> i32 {
    let mut series: string = ""
    for day in 0 to 5 {
        if day > 0 {
            series = series + ","
        }
        series = series + fmt((day * day) as f64)
    }
    r("x <- c(" + series + ")")
    py("x = [" + series + "]")
    let mean: f64 = r_num("mean(x)")
    let count: i64 = py_int("len(x)")
    println("R mean " + fmt(mean) + ", Python count " + fmt_int(count))
    println("R summary: " + r("paste(range(x), collapse = ' to ')"))
    return 0
}
```

- `py(code)` and `r(code)` return text. `py_num`, `r_num` return `f64`.
  `py_int`, `r_int` return `i64`. `fmt(f64)` and `fmt_int(i64)` turn
  numbers into short strings.
- Values cross as source text, so build a vector by joining numbers with
  commas, as above.
- This only works when FlowStudio runs the program.

## FlowStudio: graphics apps

A program that imports `stdlib/gfx.flow` runs in the FlowStudio Preview.
Draw text with `stdlib/text.flow`.

```flow check
import "stdlib/gfx.flow"
import "stdlib/text.flow"

const W: i32 = 320
const H: i32 = 200

function main() -> i32 {
    let g = gfx_open(W, H, "Bounce")
    let mut x: i32 = 20
    let mut dx: i32 = 3
    let mut frames: i32 = 0
    while gfx_frame_pump(g) {
        x = x + dx
        if x < 0 or x > W - 40 {
            dx = 0 - dx
        }
        if gfx_key_down(g, KEY_LEFT) {
            dx = -3
        }
        gfx_clear(g, 20, 24, 30)
        gfx_fill_rect(g, x, 80, 40, 40, 250, 196, 92)
        gfx_draw_text(g, 10, 10, "frames", 2, 220, 220, 220)
        gfx_draw_int(g, 100, 10, frames, 2, 220, 220, 220)
        gfx_present(g)
        gfx_wait_frame(g, 60)
        frames = frames + 1
    }
    gfx_close(g)
    return 0
}
```

- The loop is `while gfx_frame_pump(g) { ... gfx_present(g) }`. It ends
  when the user closes the window or presses Esc.
- Colors are three `i32` values from 0 to 255.
- Drawing: `gfx_clear`, `gfx_fill_rect(g, x, y, w, h, r, g, b)`,
  `gfx_draw_text(g, x, y, text, scale, r, g, b)`, `gfx_draw_int`,
  `gfx_draw_text_centered`. Input: `gfx_key_down(g, KEY_LEFT)`,
  `gfx_mouse_x(g)`, `gfx_mouse_y(g)`, `gfx_mouse_down(g, 0)`.
- `gfx.flow` defines `KEY_ESC KEY_R KEY_W KEY_A KEY_S KEY_D KEY_LEFT
  KEY_RIGHT KEY_UP KEY_DOWN`. Import `stdlib/keys.flow` for the rest, and
  never declare a key constant those modules already define.

## Common compiler errors

Each example below fails, and the message under it is the real error.

```flow error
function main() -> i32 {
    let x: i32 = 1
    x = 2
    return x
}
```

```error
Cannot assign to immutable variable 'x' (use 'let mut')
```

Fix: declare it `let mut x: i32 = 1`.

```flow error
function twice(n: i32) {
    return n * 2
}

function main() -> i32 {
    return twice(2)
}
```

```error
Function 'twice' returns i32 but should return void
```

Fix: add the return type, `function twice(n: i32) -> i32`.

```flow error
function main() -> i32 {
    let n: i32 = 4
    if n < 0 {
        println("negative")
    } else if n > 0 {
        println("positive")
    }
    return 0
}
```

```error
Flow spells `else if` as `elif`
```

```flow error
function main() -> i32 {
    let xs: array<i32, 3> = [1, 2, 3]
    for x in xs {
        println(x)
    }
    return 0
}
```

```error
parse error: unexpected token '{'
```

Fix: `for i in 0 to 3 { println(xs[i]) }`.

```flow error
function main() -> i32 {
    // a C style comment
    return 0
}
```

```error
parse error: unexpected token '/'
```

Fix: comments start with `#`.

```flow error
function add(a: i32, b: i32) -> i32 {
    return a + b
}

function main() -> i32 {
    return add(1)
}
```

```error
No matching overload for function 'add' with arguments (i32)
```

```flow error
function main() -> i32 {
    println(total)
    return 0
}
```

```error
Undefined variable 'total'
```

Other messages and their usual cause:

| Message | Fix |
| --- | --- |
| `Undefined function 'name'` | Define it, or import it: `import std.io { io_read_text }`. |
| `parse error: unexpected identifier 'fn'` | Write `function`. |
| `parse error: unexpected token '=>'` | Only one pattern per arm. Use `_` for the default. |
| `'main' must return 'int'` (from the C build) | Declare `function main() -> i32` and `return 0`. |
| `initializing 'double *' with an expression of incompatible type` (from the C build) | Give the array a size: `array<f64, 3>`. |
| `Undefined symbols ... "_length"` or `"_max"` (from the C build) | That function does not exist. Track sizes yourself and write helpers. |
