(() => {
  // Wakes the API and its database while the app's scripts download, so the first real request
  // does not also wait for a cold start. Best effort: nothing waits on it and failures are ignored.
  try {
    if (navigator.onLine !== false) fetch('/health?db=1', { cache: 'no-store', credentials: 'omit' }).catch(() => {});
  } catch {
    // fetch can be unavailable; the app's own requests still work.
  }
  // The saved theme is a device copy of the signed-in account's setting. Without one (first visit or
  // signed out) the browser or OS appearance applies.
  let saved = null;
  try {
    const value = localStorage.getItem('workout-theme');
    if (value === 'light' || value === 'dark') saved = value;
  } catch {
    // Browser storage can be disabled; the browser or OS appearance still applies.
  }
  const theme = saved ?? (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

  document.documentElement.dataset.theme = theme;
  const metas = [...document.querySelectorAll('meta[name="theme-color"]')];
  if (!metas[0] || !saved) return;

  metas[0].removeAttribute('media');
  metas[0].setAttribute('content', theme === 'light' ? '#F4F2FA' : '#08080A');
  metas.slice(1).forEach(meta => meta.remove());
})();
