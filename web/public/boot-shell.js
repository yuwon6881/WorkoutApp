// Draws the app's first frame from the <template> that the build put into index.html, so a cold
// start paints the loading shell before the scripts have parsed. A cancelled sign-in returns to the
// sign-in screen instead, so the training shell is left out there, and a device with no sign-in
// behind it (src/lib/signedInDevice.ts) draws the neutral mark rather than an Overview shape that
// would turn into the sign-in card. Kept as a same-origin file because the Content-Security-Policy
// (script-src 'self') blocks inline scripts.
(() => {
  try {
    if (location.pathname === '/' && new URLSearchParams(location.search).get('central_error')) return;
    let returning = true;
    try { returning = Boolean(localStorage.getItem('workout-signed-in') || localStorage.getItem('workout-launch-snapshot')); } catch { /* Assume a returning lifter. */ }
    const template = document.getElementById(returning ? 'boot-shell' : 'boot-splash') || document.getElementById('boot-shell');
    const root = document.getElementById('root');
    if (template && root && !root.firstChild) root.appendChild(template.content.cloneNode(true));
  } catch {
    // Without the shell the page waits for React's first render, as it always could.
  }
})();
