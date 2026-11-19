/* Loaded only by the static Pages build. Native API calls stay in the browser. */
(function () {
  'use strict';
  globalThis.FlowStudioPages = true;
  const request = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async function (input, options) {
    const url = new URL(input instanceof Request ? input.url : input, document.baseURI);
    if (url.origin === location.origin && /^\/api\//.test(url.pathname)) {
      if (url.pathname === '/api/flow/backends') return Response.json({
        c: { available: true, reason: 'Flow compiler and Clang/LLD run as WebAssembly.' },
        mlir: { available: false, reason: 'MLIR execution needs a browser MLIR lowering toolchain. Select C to WebAssembly.' }
      });
      if (url.pathname === '/api/run/flow' || url.pathname === '/api/check/flow') {
        const source = input instanceof Request ? await input.clone().text() : String(options?.body || '');
        const result = await globalThis.FlowStudioBrowserFlow.run(source, { check: url.pathname === '/api/check/flow' });
        return new Response(result.output, { status: result.ok ? 200 : 422, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      }
      if (url.pathname === '/api/run/flow-mlir') return new Response('MLIR execution needs a browser MLIR lowering toolchain. Select C to WebAssembly to run Flow here.', { status: 422 });
      return Promise.resolve(new Response(
        'Native execution requires the local FlowStudio app. Use Install FlowStudio above, or open the Python and R browser workspace.',
        { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
      ));
    }
    return request(input, options);
  };
}());
