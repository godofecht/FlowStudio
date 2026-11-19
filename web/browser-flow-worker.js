/* Real Flow compiler -> C -> Clang/LLD -> WebAssembly, inside this worker. */
'use strict';
const runtime = new URL('./flow-runtime/', self.location.href);
const encoder = new TextEncoder();
const MAX_OUTPUT = 65536;
let stdout = '';
let diagnostics = '';
let outputBytes = 0;
let diagnosticBytes = 0;
let phase = 'compile';
function progress(stage, message) { postMessage({ type: 'progress', stage, message }); }
function capture(text) {
  if (phase === 'execute') {
    outputBytes += encoder.encode(text).length;
    if (outputBytes > MAX_OUTPUT) throw new Error('Flow output exceeds 64 KiB.');
    stdout += text;
  } else {
    diagnosticBytes += encoder.encode(text).length;
    if (diagnosticBytes > MAX_OUTPUT) throw new Error('Compiler diagnostics exceed 64 KiB.');
    diagnostics += text;
  }
}
async function bytes(name) {
  const response = await fetch(new URL(name, runtime));
  if (!response.ok) throw new Error(`Could not load browser compiler asset ${name}: HTTP ${response.status}`);
  return response.arrayBuffer();
}
self.onmessage = async ({ data }) => {
  try {
    if (typeof data.source !== 'string' || encoder.encode(data.source).length > 131072) throw new Error('Flow source exceeds 128 KiB.');
    progress('load', 'Loading the Flow WebAssembly toolchain...');
    const [{ default: createCompiler }, libraryBuffer] = await Promise.all([
      import(new URL('flowc.js', runtime)), bytes('stdlib.json')
    ]);
    const library = JSON.parse(new TextDecoder().decode(libraryBuffer));
    const compiler = await createCompiler({
      noInitialRun: true,
      print: text => capture(text + '\n'), printErr: text => capture(text + '\n'),
      preRun: [module => Object.assign(module.ENV, {
        FLOWC_IN: '/project/main.flow', FLOWC_OUT: '/project/main.c',
        FLOWC_ROOT: '/flow', FLOWC_DIR: '/flow', FLOWC_BUNDLE: '1'
      })]
    });
    compiler.FS.mkdirTree('/project');
    compiler.FS.writeFile('/project/flow.toml', '');
    compiler.FS.writeFile('/project/main.flow', data.source);
    for (const [path, source] of Object.entries(library)) {
      compiler.FS.mkdirTree(path.slice(0, path.lastIndexOf('/')));
      compiler.FS.writeFile(path, source);
    }
    compiler.FS.chdir('/flow');
    progress('compile', 'Compiling Flow to C...');
    const code = compiler.callMain([]);
    if (code !== 0) throw new Error(`Flow compiler exited with code ${code}.`);
    const source = compiler.FS.readFile('/project/main.c', { encoding: 'utf8' });
    if (source.length > 4194304) throw new Error('Generated C exceeds 4 MiB.');
    if (data.check) {
      postMessage({ type: 'result', ok: true, output: 'Flow compiler checks passed.\n' });
      return;
    }
    progress('load', 'Loading browser Clang and LLD...');
    importScripts(new URL('shared.js', runtime).href);
    const api = new FlowStudioWasmClang({
      readBuffer: bytes, compileStreaming: async name => WebAssembly.compile(await bytes(name)), hostWrite: capture
    });
    // The driver's own progress messages stay out of the program transcript.
    api.hostLog = () => {};
    await api.ready;
    api.memfs.setStdinStr('');
    api.memfs.addDirectory('flowstudio');
    api.memfs.addDirectory('flowstudio/sys');
    // WASI has no process RSS measurement. Report the unavailable syscall.
    api.memfs.addFile('flowstudio/sys/resource.h', encoder.encode('struct rusage { long ru_maxrss; };\nstatic inline int getrusage(int who, struct rusage *r) { return -1; }\n'));
    api.memfs.addFile('program.c', encoder.encode(source));
    const [clang, lld] = await Promise.all([api.getModule('clang'), api.getModule('lld')]);
    progress('compile', 'Compiling C to WebAssembly...');
    await api.run(clang, 'clang', '-cc1', '-emit-obj', ...api.clangCommonArgs,
      '-I/flowstudio', '-O1', '-Wno-implicit-function-declaration', '-o', 'program.o', '-x', 'c', 'program.c');
    await api.run(lld, 'wasm-ld', '--no-threads', '--max-memory=536870912', '-z', 'stack-size=16777216', '-Llib/wasm32-wasi',
      'lib/wasm32-wasi/crt1.o', 'program.o', '-lc', '-lc++', '-lc++abi', '-lcanvas', '-o', 'program.wasm');
    const program = await WebAssembly.compile(api.memfs.getFileContents('program.wasm'));
    phase = 'execute';
    // Keep the driver's trailing newline out of the program's raw stdout.
    // MemFS retains its original capture callback for actual fd writes.
    api.hostWrite = () => {};
    progress('execute', 'Running compiled WebAssembly...');
    await api.run(program, 'program.wasm');
    postMessage({ type: 'result', ok: true, output: stdout });
  } catch (error) {
    const output = (phase === 'execute' ? stdout : diagnostics) + '\n' + String(error.message || error);
    postMessage({ type: 'result', ok: false, output });
  }
};
