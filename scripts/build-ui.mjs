import { build } from 'esbuild';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

await mkdir('web/ui', { recursive: true });
// Monaco includes a vendored sanitizer. Use the patched, pinned package in both bundles.
const shared = { bundle: true, minify: true, target: 'es2022', legalComments: 'linked',
  plugins: [{ name: 'patched-sanitizer', setup(build) {
    build.onResolve({ filter: /dompurify\/dompurify\.js$/ }, () => ({
      path: resolve('node_modules/dompurify/dist/purify.es.mjs')
    }));
  } }] };
await build({ ...shared, entryPoints: ['frontend/main.js'], outfile: 'web/ui/workbench.js',
  format: 'esm', loader: { '.ttf': 'dataurl' },
  // Served at runtime by the native server's allowlisted static routes.
  external: ['/ide_completion_core.js'] });
await build({ ...shared,
  entryPoints: ['node_modules/monaco-editor/esm/vs/editor/editor.worker.js'],
  outfile: 'web/ui/editor.worker.js', format: 'iife' });
const notices = await Promise.all([
  ['monaco-editor', 'LICENSE'], ['lucide', 'LICENSE'], ['dompurify', 'LICENSE']
].map(async ([name, file]) => `${name}\n${await readFile(`node_modules/${name}/${file}`, 'utf8')}`));
await writeFile('web/ui/THIRD_PARTY_LICENSES.txt', notices.join('\n\n'));
console.log('Built local Monaco editor, worker and workbench assets.');
