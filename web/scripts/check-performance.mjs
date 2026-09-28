import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const root = resolve(import.meta.dirname, '../dist');
const html = readFileSync(resolve(root, 'index.html'), 'utf8');
const initial = [...html.matchAll(/(?:src|href)="(\/assets\/[^\"]+\.(?:js|css))"/g)]
  .map(match => ({ path: match[1], bytes: gzipSync(readFileSync(resolve(root, `.${match[1]}`))).length }));
const javascript = initial.filter(x => x.path.endsWith('.js')).reduce((total, x) => total + x.bytes, 0);
const css = initial.filter(x => x.path.endsWith('.css')).reduce((total, x) => total + x.bytes, 0);
// Frozen production-build evidence from the pre-optimization checkout, September 28 2026.
const baseline = { javascript: 101295, css: 39177 };
console.log(JSON.stringify({ gzipBytes: { javascript, css }, baseline, cssReduction: 1 - css / baseline.css }, null, 2));
if (javascript > baseline.javascript || css > baseline.css * 0.75) {
  console.error('Initial JavaScript must not grow; initial CSS must shrink by at least 25%.');
  process.exitCode = 1;
}
