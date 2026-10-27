import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Plugin } from 'vite';
import { AppLoading } from '../src/components/AppLoading';

// Until the scripts have downloaded, parsed and rendered, the page has only an empty root, so a cold
// start (the first open of the day, after Android has closed the app) paints a blank screen. The
// app's first frame is put into the document as a <template>, and public/boot-shell.js copies it
// into the root while the page is still parsing (leaving it out on a cancelled sign-in). The
// stylesheet is linked in the head, so it paints styled at once, and React replaces it on its first
// render. Rendering the real AppLoading keeps the two from drifting apart.
export function bootShell(): Plugin {
  return {
    name: 'boot-shell',
    apply: 'build',
    transformIndexHtml(html) {
      const root = '<div id="root"></div>';
      if (!html.includes(root)) throw new Error('index.html no longer has an empty #root for the boot shell.');
      const shell = renderToStaticMarkup(createElement(AppLoading));
      return html.replace(root, `${root}<template id="boot-shell">${shell}</template><script src="/boot-shell.js"></script>`);
    }
  };
}
