import { describe, expect, it } from 'vitest';
import { assetResponsePlugin } from '../../scripts/static-asset-cache';

describe('runtime asset cache validation', () => {
  it.each([['app.js', 'application/javascript'], ['app.css', 'text/css'], ['font.woff2', 'font/woff2']])(
    'accepts a successful %s with its real content type', async (file, mime) => {
      const response = new Response('asset', { headers: { 'Content-Type': mime } });
      expect(await assetResponsePlugin.cacheWillUpdate({ request: new Request(`https://workout.test/assets/${file}`), response })).toBe(response);
    });
  it.each(['app.js', 'app.css', 'font.woff2'])('never caches an HTML fallback for %s', async file => {
    const response = new Response('<html>shell</html>', { headers: { 'Content-Type': 'text/html' } });
    expect(await assetResponsePlugin.cacheWillUpdate({ request: new Request(`https://workout.test/assets/${file}`), response })).toBeNull();
  });
  it('rejects error and redirect responses', async () => {
    const request = new Request('https://workout.test/assets/app.js');
    for (const response of [new Response('unavailable', { status: 503 }), Response.redirect('https://workout.test/')])
      expect(await assetResponsePlugin.cacheWillUpdate({ request, response })).toBeNull();
  });
});
