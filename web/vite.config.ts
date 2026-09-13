import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// In production Vercel rewrites /api to Cloud Run. Locally the same paths are proxied so the
// browser always talks to one origin and the session cookie stays first-party.
const apiTarget = process.env.WORKOUT_API ?? 'http://127.0.0.1:5183';
const proxy = { '/api': { target: apiTarget, changeOrigin: false }, '/health': { target: apiTarget, changeOrigin: false } };

export default defineConfig({
  appType: 'mpa',
  server: { proxy },
  preview: { proxy },
  plugins: [react(), VitePWA({
    registerType: 'prompt',
    includeAssets: ['favicon.svg', 'icon-192.png', 'icon-512.png'],
    manifest: {
      name: 'Workout', short_name: 'Workout',
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
      cleanupOutdatedCaches: true
    }
  })]
});
