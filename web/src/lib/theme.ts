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

export function forgetTheme(): void {
  try { localStorage.removeItem(themeKey); } catch { /* Nothing was saved when browser storage is unavailable. */ }
}

/** The browser or OS appearance. */
export function systemTheme(): Theme {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  const metas = [...document.querySelectorAll('meta[name="theme-color"]')];
  const background = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  const color = background || (theme === 'light' ? '#fcfcfc' : '#0b0e14');
  if (metas[0]) {
    metas[0].removeAttribute('media');
    metas[0].setAttribute('content', color);
    metas.slice(1).forEach(meta => meta.remove());
  }
}

/** The saved account theme, else the browser or OS appearance. */
export const initialTheme = (): Theme => storedTheme() ?? systemTheme();
