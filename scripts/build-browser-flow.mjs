import { readFile, writeFile, mkdir, cp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const lock = JSON.parse(await readFile('scripts/browser-flow/toolchain.lock.json', 'utf8'));
const cache = resolve('build/browser-flow');
const digest = data => createHash('sha256').update(data).digest('hex');
const shim = await readFile('scripts/browser-flow/write-shim.c');
export const browserFlowToolchain = digest(JSON.stringify(lock) + shim.toString());
async function download(url, path, expected) {
  try { if (digest(await readFile(path)) === expected) return; } catch {}
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`Toolchain download failed: ${response.status} ${url}`);
  const data = Buffer.from(await response.arrayBuffer());
  if (digest(data) !== expected) throw new Error(`Toolchain checksum mismatch: ${url}`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, data);
}
export async function buildBrowserFlow(target) {
  const jobs = [];
  for (const [path, hash] of Object.entries(lock.flow.files)) {
    jobs.push(() => download(`https://raw.githubusercontent.com/flooooooooooow/flow/${lock.flow.revision}/${path}`, `${cache}/source/${path}`, hash));
  }
  for (const [path, hash] of Object.entries(lock.clang.files)) {
    jobs.push(() => download(`https://raw.githubusercontent.com/binji/wasm-clang/${lock.clang.revision}/${path}`, `${cache}/clang/${path}`, hash));
  }
  await Promise.all(Array.from({ length: 8 }, async () => { while (jobs.length) await jobs.shift()(); }));
  await mkdir(`${cache}/compiler`, { recursive: true });
  const key = browserFlowToolchain;
  let built = false;
  try {
    const saved = JSON.parse(await readFile(`${cache}/compiler/build.json`, 'utf8'));
    built = saved.key === key && saved.wasm === digest(await readFile(`${cache}/compiler/flowc.wasm`)) && saved.loader === digest(await readFile(`${cache}/compiler/flowc.mjs`));
  } catch {}
  if (!built) {
    const emcc = process.env.EMCC || 'emcc';
    const version = execFileSync(emcc, ['--version'], { encoding: 'utf8' });
    if (!version.includes(lock.emscripten)) throw new Error(`Browser compiler requires Emscripten ${lock.emscripten}`);
    execFileSync(emcc, [`${cache}/source/compiler/bootstrap/flowc_stage_a.c`, '-Dwrite=flowstudio_wasm_write', '-O2', '-w', '-c', '-o', `${cache}/compiler/flowc.o`], { stdio: 'inherit' });
    execFileSync(emcc, [`${cache}/compiler/flowc.o`, 'scripts/browser-flow/write-shim.c', '-O2', '-w', '-lm',
      '-sMODULARIZE=1', '-sEXPORT_ES6=1', '-sEXPORT_NAME=createFlowCompiler', '-sENVIRONMENT=web,worker,node',
      '-sINVOKE_RUN=0', '-sALLOW_MEMORY_GROWTH=1', '-sSTACK_SIZE=16777216', '-sINITIAL_MEMORY=67108864', '-sMAXIMUM_MEMORY=536870912',
      '-sEXPORTED_RUNTIME_METHODS=["FS","ENV","callMain"]', '-o', `${cache}/compiler/flowc.mjs`], { stdio: 'inherit' });
    await writeFile(`${cache}/compiler/build.json`, JSON.stringify({ key, wasm: digest(await readFile(`${cache}/compiler/flowc.wasm`)), loader: digest(await readFile(`${cache}/compiler/flowc.mjs`)) }));
  }
  await mkdir(target, { recursive: true });
  await cp(`${cache}/compiler/flowc.mjs`, `${target}/flowc.js`);
  await cp(`${cache}/compiler/flowc.wasm`, `${target}/flowc.wasm`);
  for (const file of ['clang', 'lld', 'memfs', 'sysroot.tar', 'LICENSE', 'LICENSE.llvm']) await cp(`${cache}/clang/${file}`, `${target}/${file}`);
  await cp(`${cache}/source/LICENSE`, `${target}/LICENSE.flow`);
  const original = await readFile(`${cache}/clang/shared.js`, 'utf8');
  const start = original.indexOf('function readStr(');
  const end = original.indexOf('\n}\n', start) + 3;
  if (start < 0 || end < start) throw new Error('Pinned Clang host string adapter changed');
  const utf8 = 'function readStr(u8, o, len = -1) {\n  let end = len < 0 ? u8.length : Math.min(u8.length, o + len);\n  let stop = o; while (stop < end && u8[stop] !== 0) stop++;\n  return new TextDecoder().decode(u8.subarray(o, stop));\n}\n';
  await writeFile(`${target}/shared.js`, original.slice(0, start) + utf8 + original.slice(end) + '\nglobalThis.FlowStudioWasmClang = API;\n');
  await writeFile(`${target}/NOTICE.flowstudio`, 'Clang/WASI host adapter from binji/wasm-clang. FlowStudio changes: decode host strings as UTF-8 and expose the API to the worker. Original Apache and LLVM licences are included. Flow has separate terms in LICENSE.flow.\n');
  const library = {};
  for (const path of Object.keys(lock.flow.files).filter(path => path.endsWith('.flow'))) library[`/flow/${path}`] = await readFile(`${cache}/source/${path}`, 'utf8');
  await writeFile(`${target}/stdlib.json`, JSON.stringify(library));
  await writeFile(`${target}/provenance.json`, JSON.stringify({ flow: lock.flow.revision, clang: lock.clang.revision, emscripten: lock.emscripten }));
  console.log(`Built real Flow/Wasm browser toolchain from ${lock.flow.revision}`);
}
