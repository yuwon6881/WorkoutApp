import { describe, expect, it } from 'vitest';
import { shouldCrossfadeTheme } from './theme';

const capable = { canTransition: true, reducedMotion: false, androidShell: false };

describe('shouldCrossfadeTheme', () => {
  it('fades a change from one showing theme to the other', () => {
    expect(shouldCrossfadeTheme('dark', 'light', capable)).toBe(true);
  });

  it('applies the first theme and an unchanged one outright', () => {
    expect(shouldCrossfadeTheme(undefined, 'dark', capable)).toBe(false);
    expect(shouldCrossfadeTheme('dark', 'dark', capable)).toBe(false);
  });

  it('never fades without browser support, for reduced motion, or in the Android app', () => {
    expect(shouldCrossfadeTheme('dark', 'light', { ...capable, canTransition: false })).toBe(false);
    expect(shouldCrossfadeTheme('dark', 'light', { ...capable, reducedMotion: true })).toBe(false);
    expect(shouldCrossfadeTheme('dark', 'light', { ...capable, androidShell: true })).toBe(false);
  });
});
