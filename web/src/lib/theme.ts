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

export interface ThemeSwapEnvironment {
  canTransition: boolean;
  reducedMotion: boolean;
  androidShell: boolean;
}

/** A swap is cross-faded only when a theme is already showing and differs, motion is welcome, and the
 *  browser can. The Android app skips it: it keeps its page rastered and a full-page snapshot is the
 *  costliest thing it could be asked to draw. */
export function shouldCrossfadeTheme(current: string | undefined, next: Theme, env: ThemeSwapEnvironment): boolean {
  return Boolean(current) && current !== next && env.canTransition && !env.reducedMotion && !env.androidShell;
}

/** Resolves once the new theme is on the page, which a cross-fade defers by a frame, so the status bar
 *  and theme colour are read from the theme that is actually showing. */
export function applyTheme(theme: Theme, animate = true): Promise<void> {
  const root = document.documentElement;
  const swap = () => {
    root.dataset.theme = theme;
    const metas = [...document.querySelectorAll('meta[name="theme-color"]')];
    const background = getComputedStyle(root).getPropertyValue('--bg').trim();
    const color = background || (theme === 'light' ? '#F4F2FA' : '#08080A');
    if (metas[0]) {
      metas[0].removeAttribute('media');
      metas[0].setAttribute('content', color);
      metas.slice(1).forEach(meta => meta.remove());
    }
  };
  const crossfade = animate && shouldCrossfadeTheme(root.dataset.theme, theme, {
    canTransition: typeof document.startViewTransition === 'function',
    reducedMotion: Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches),
    androidShell: root.dataset.shell === 'android'
  });
  if (!crossfade) {
    swap();
    return Promise.resolve();
  }
  return new Promise(resolve => {
    document.startViewTransition(() => { swap(); resolve(); });
  });
}

/** The saved account theme, else the browser or OS appearance. */
export const initialTheme = (): Theme => storedTheme() ?? systemTheme();
