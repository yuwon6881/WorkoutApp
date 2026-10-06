import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getVideoEmbedInfo } from './videoEmbed';

// The demo modal frames these players; a CSP without a matching frame-src falls back to
// default-src 'self' and the browser shows "This content is blocked" instead of the video.
const embedOrigins = [
  'https://youtu.be/SJqInYJcd6c',
  'https://vimeo.com/76979871'
].map(url => new URL(getVideoEmbedInfo(url).embedUrl!).origin);

function frameSources(policy: string) {
  const directive = policy.split(';').map(part => part.trim()).find(part => part.startsWith('frame-src '));
  return directive ? directive.split(/\s+/).slice(1) : [];
}

describe('video embed content security policy', () => {
  it('lets the Vercel-served shell frame every embedded player', () => {
    const config = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8')) as {
      routes: { headers?: Record<string, string> }[];
    };
    const policy = config.routes.find(route => route.headers?.['Content-Security-Policy'])!.headers!['Content-Security-Policy'];
    expect(frameSources(policy)).toEqual(expect.arrayContaining(embedOrigins));
  });

  it('lets the API-served shell frame every embedded player', () => {
    const source = readFileSync(new URL('../../../api/Program.cs', import.meta.url), 'utf8');
    const policy = /ContentSecurityPolicy="([^"]+)"/.exec(source)![1];
    expect(frameSources(policy)).toEqual(expect.arrayContaining(embedOrigins));
  });
});
