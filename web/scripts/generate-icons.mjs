import { writeFileSync } from 'node:fs';
import sharp from 'sharp';

// Every web icon is written from here (run `node scripts/generate-icons.mjs` from web/). The W
// spans 61% of the tile: a wide, light stroke needs that width to match the optical weight of the
// sibling apps' icons (Financial, Nutrition, Calendar), so the four sit evenly side by side on a
// home screen. Launchers mask the square themselves, so the maskable and iOS icons are full-bleed;
// the "any" icons carry the shared 22.5% corners because a desktop or browser shows them as drawn.
// The W's farthest corner sits inside the maskable safe zone (a centred circle of 80%), so one
// drawing serves both.
const W_PATH = 'm120 168 55 176 81-128 81 128 55-176';
const TILE = '#0b0e14';
const SCALE = 1;
const RADIUS = 115;

const icon = radius => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" rx="${radius}" fill="${TILE}" />
  <g transform="translate(256 256) scale(${SCALE}) translate(-256 -256)">
    <path d="${W_PATH}" fill="none" stroke="#ffffff" stroke-width="42" stroke-linecap="round" stroke-linejoin="round" />
  </g>
</svg>`;

const rounded = icon(RADIUS);
const square = icon(0);

const jobs = [
  [rounded, 192, 'public/icon-192.png'],
  [rounded, 512, 'public/icon-512.png'],
  [square, 512, 'public/icon-maskable-512.png'],
  [square, 180, 'public/apple-touch-icon.png'],
];

for (const [svg, size, out] of jobs) {
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(out);
  console.log(`wrote ${out} (${size}x${size})`);
}

writeFileSync('public/favicon.svg', `${rounded.replace(' width="512" height="512"', '')}\n`);
console.log('wrote public/favicon.svg');
