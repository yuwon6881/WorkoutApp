import type { Theme } from '../types';

const themeKey = 'workout-theme';

export function storedTheme(): Theme | null {
  try {
    const value = localStorage.getItem(themeKey);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

export function rememberTheme(theme: Theme): void {
  try { localStorage.setItem(themeKey, theme); } catch { /* The current page still uses the selected theme. */ }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  const metas = [...document.querySelectorAll('meta[name="theme-color"]')];
  const background = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  const color = background || (theme === 'light' ? '#f8fafc' : '#0b0e14');
  if (metas[0]) {
    metas[0].removeAttribute('media');
    metas[0].setAttribute('content', color);
    metas.slice(1).forEach(meta => meta.remove());
  }
}

export const initialTheme = (): Theme => storedTheme() ?? 'dark';
