import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';

const packageVersion = (JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }).version;
const buildRevision = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? process.env.GITHUB_SHA?.slice(0, 7) ?? 'local';

// In production Vercel rewrites /api to Cloud Run. Locally the same paths are proxied so the
// browser always talks to one origin and the session cookie stays first-party.
const apiTarget = process.env.WORKOUT_API ?? 'http://127.0.0.1:5183';
// The shell's tab paths (app/useTabNavigation.ts) serve index.html, as vercel.json does in
// production. Everything else keeps the multi-page behaviour: an unknown path is a real 404.
const tabPaths = /^\/(?:settings|workouts|muscles|exercises|import)\/?(?:[?#].*)?$/;
// Returns nothing on purpose: a function returned from these hooks is run as a later middleware.
function serveTabShell(server: { middlewares: { use: (handler: (req: { url?: string }, res: unknown, next: () => void) => void) => void } }): void {
  server.middlewares.use((req, _res, next) => {
    if (req.url && tabPaths.test(req.url)) req.url = '/index.html';
    next();
  });
}
const tabShell: Plugin = {
  name: 'workout-tab-shell',
  configureServer: serveTabShell,
  configurePreviewServer: serveTabShell
};
const proxy = { '/api': { target: apiTarget, changeOrigin: false }, '/health': { target: apiTarget, changeOrigin: false } };

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(`${packageVersion}+${buildRevision}`) },
  appType: 'mpa',
  server: { proxy },
  preview: { proxy },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalized = id.replaceAll('\\', '/');
          if (normalized.includes('/node_modules/firebase/') || normalized.includes('/node_modules/@firebase/'))
            return 'firebase-push';
        }
      }
    }
  },
  plugins: [react(), tabShell, VitePWA({
    // The app registers the worker itself (app/useAppUpdate.ts) and offers updates when idle.
    registerType: 'prompt',
    injectRegister: false,
    includeAssets: ['favicon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png', 'rest-alert-sw.js'],
    manifest: {
      id: '/', name: 'Workout', short_name: 'Workout',
      description: 'Plan, train, and track your lifting. Your training is saved to your account.',
      theme_color: '#0b0e14', background_color: '#0b0e14', display: 'standalone', start_url: '/', scope: '/',
      orientation: 'portrait', categories: ['health', 'fitness', 'sports'],
      // A maskable icon is cropped to a circle or squircle, so it carries its own padded artwork
      // instead of sharing the "any" icon, whose glyph would be clipped.
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
      ],
      // Long-press the home-screen icon to jump straight in. /?start=today opens today's workout.
      shortcuts: [
        { name: "Start today's workout", short_name: 'Train', url: '/?start=today', icons: [{ src: '/icon-192.png', sizes: '192x192' }] },
        { name: 'Workouts', url: '/workouts', icons: [{ src: '/icon-192.png', sizes: '192x192' }] },
        { name: 'Muscle coverage', short_name: 'Muscles', url: '/muscles', icons: [{ src: '/icon-192.png', sizes: '192x192' }] }
      ]
    },
    workbox: {
      navigateFallback: '/index.html',
      // Only the static shell is precached. Training data is never cached: an API request must
      // reach the server or fail visibly, and must never be answered with the SPA document.
      navigateFallbackDenylist: [/^\/assets\//, /^\/api\//, /^\/health$/],
      globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
      // PDF.js is loaded only after a user selects an import. Keep its large worker and dynamic
      // chunks out of the install-time download; the importer remains available online and the
      // rest of the workout shell stays fast on a fresh install.
      globIgnores: ['**/assets/*pdf*', '**/assets/*PDF*', '**/assets/firebase-push-*.js',
        // Inter's Cyrillic, Greek and Vietnamese subsets load only for text that needs them, so they
        // are fetched on demand rather than installed with the shell.
        '**/assets/inter-cyrillic*', '**/assets/inter-greek*', '**/assets/inter-vietnamese*'],
      // The rest-timer notification needs a click handler in the worker itself. It is imported
      // rather than hand-written as a whole worker so Workbox keeps owning the precache.
      importScripts: ['rest-alert-sw.js'],
      cleanupOutdatedCaches: true
    }
  })]
});
