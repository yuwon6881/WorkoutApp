// Workbox serializes this callback into the worker; it must not close over build-time helpers.
export const assetResponsePlugin = {
  cacheWillUpdate: async ({ request, response }: { request: Request; response: Response }) => {
    if (response.status !== 200 || response.redirected) return null;
    const path = new URL(request.url).pathname;
    const mime = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? '';
    const valid = /\.js$/.test(path) ? /^(?:text|application)\/(?:javascript|ecmascript)$/.test(mime)
      : /\.css$/.test(path) ? mime === 'text/css'
      : /^(?:font\/|application\/(?:font-|vnd\.ms-fontobject|octet-stream))/.test(mime);
    return valid ? response : null;
  }
};

