/* Loaded only by the static Pages build. Native API calls stay in the browser. */
(function () {
  'use strict';
  globalThis.FlowStudioPages = true;
  const request = globalThis.fetch.bind(globalThis);
  globalThis.fetch = function (input, options) {
    const url = new URL(input instanceof Request ? input.url : input, document.baseURI);
    if (url.origin === location.origin && /^\/api\//.test(url.pathname)) {
      return Promise.resolve(new Response(
        'Native execution requires the local FlowStudio app. Use Install FlowStudio above, or open the Python and R browser workspace.',
        { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
      ));
    }
    return request(input, options);
  };
}());
