// Draws the app's first frame from the <template> that the build put into index.html, so a cold
// start paints the loading shell before the scripts have parsed. A cancelled sign-in returns to the
// sign-in screen instead, so the training shell is left out there. Kept as a same-origin file
// because the Content-Security-Policy (script-src 'self') blocks inline scripts.
(() => {
  try {
    if (location.pathname === '/' && new URLSearchParams(location.search).get('central_error')) return;
    const template = document.getElementById('boot-shell');
    const root = document.getElementById('root');
    if (template && root && !root.firstChild) root.appendChild(template.content.cloneNode(true));
  } catch {
    // Without the shell the page waits for React's first render, as it always could.
  }
})();
