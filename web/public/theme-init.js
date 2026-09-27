(() => {
  let theme = 'dark';
  try {
    const saved = localStorage.getItem('workout-theme');
    if (saved === 'light' || saved === 'dark') theme = saved;
  } catch {
    // The default theme is still available when browser storage is disabled.
  }

  document.documentElement.dataset.theme = theme;
  const metas = [...document.querySelectorAll('meta[name="theme-color"]')];
  if (!metas[0]) return;

  metas[0].removeAttribute('media');
  metas[0].setAttribute('content', theme === 'light' ? '#f8fafc' : '#0b0e14');
  metas.slice(1).forEach(meta => meta.remove());
})();
