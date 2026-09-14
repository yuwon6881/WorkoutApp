import { build } from 'vite';

// VitePWA finishes the bundle but can leave a Workbox/esbuild handle alive on
// Windows. The build promise has completed at this point, so explicitly end
// the short-lived build process instead of making container builds hang.
await build();
process.exit(0);
