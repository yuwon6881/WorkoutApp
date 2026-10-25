import type { Plugin } from 'vite';

// The browser discovers the Latin font only after the stylesheet has downloaded and the text has
// been laid out, so first paint uses the fallback font and then swaps. A preload starts the download
// with the stylesheet instead. Other subsets still load on demand through their unicode-range rules.
const latinFont = /(?:^|\/)plus-jakarta-sans-latin-wght-normal-[\w-]+\.woff2$/;

export function preloadLatinFont(): Plugin {
  return {
    name: 'preload-latin-font',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(_html, context) {
        const file = Object.keys(context.bundle ?? {}).find(name => latinFont.test(name));
        if (!file) return [];
        // Fonts are fetched in anonymous CORS mode, so the preload must match or it is fetched twice.
        return [{
          tag: 'link',
          attrs: { rel: 'preload', as: 'font', type: 'font/woff2', href: `/${file}`, crossorigin: '' },
          injectTo: 'head'
        }];
      }
    }
  };
}
