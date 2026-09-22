import sharp from 'sharp';

const W_PATH = 'm120 168 55 176 81-128 81 128 55-176';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" fill="#0b0e14" />
  <path d="${W_PATH}" fill="none" stroke="#ffffff" stroke-width="42" stroke-linecap="round" stroke-linejoin="round" />
</svg>`;

const jobs = [
  [192, 'public/icon-192.png'],
  [512, 'public/icon-512.png'],
];

for (const [size, out] of jobs) {
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(out);
  console.log(`wrote ${out} (${size}x${size})`);
}
