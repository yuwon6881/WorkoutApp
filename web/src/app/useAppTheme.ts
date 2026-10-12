import { useEffect } from 'react';
import type { Theme } from '../types';
import { applyTheme, forgetTheme, initialTheme, rememberTheme } from '../lib/theme';
import { setNativeStatusBar } from '../lib/platform';

export function useAppTheme(themePreference: Theme | undefined, signedOut: boolean): void {
  useEffect(() => {
    const saved = themePreference;
    // Signing out drops the device copy so the sign-in screen follows the browser or OS.
    if (signedOut) forgetTheme();
    const sync = () => {
      const theme = saved ?? initialTheme();
      applyTheme(theme);
      const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
      if (bg) setNativeStatusBar(theme === 'light' ? 'light' : 'dark', bg);
    };
    if (saved) rememberTheme(saved);
    sync();
    if (saved) return undefined;
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    media?.addEventListener('change', sync);
    return () => media?.removeEventListener('change', sync);
  }, [themePreference, signedOut]);
}
