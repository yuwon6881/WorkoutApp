import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';

const packageVersion = (JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }).version;
const buildRevision = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? process.env.GITHUB_SHA?.slice(0, 7) ?? 'local';

// In production Vercel rewrites /api to Cloud Run. Locally the same paths are proxied so the
// browser always talks to one origin and the session cookie stays first-party.
const apiTarget = process.env.WORKOUT_API ?? 'http://127.0.0.1:5183';
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
  plugins: [react(), VitePWA({
    registerType: 'autoUpdate',
    includeAssets: ['favicon.svg', 'icon-192.png', 'icon-512.png', 'rest-alert-sw.js'],
    manifest: {
      id: '/', name: 'Workout', short_name: 'Workout',
      description: 'Plan, train, and track your lifting. Your training is saved to your account.',
      theme_color: '#0b0e14', background_color: '#0b0e14', display: 'standalone', start_url: '/', scope: '/',
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
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
      globIgnores: ['**/assets/*pdf*', '**/assets/*PDF*', '**/assets/firebase-push-*.js'],
      // The rest-timer notification needs a click handler in the worker itself. It is imported
      // rather than hand-written as a whole worker so Workbox keeps owning the precache.
      importScripts: ['rest-alert-sw.js'],
      cleanupOutdatedCaches: true
    }
  })]
});
