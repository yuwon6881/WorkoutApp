import { describe, expect, it } from 'vitest';
import { navCurrent, navSection } from './navigation';

describe('navigation sections', () => {
  it('places Import under Workouts and leaves destinations as themselves', () => {
    expect(navSection('import')).toBe('program');
    expect(navSection('program')).toBe('program');
    expect(navSection('settings')).toBe('settings');
  });

  it('marks the destination as the page and its parent section as current', () => {
    expect(navCurrent('program', 'program')).toBe('page');
    expect(navCurrent('import', 'program')).toBe('true');
    expect(navCurrent('import', 'overview')).toBeUndefined();
    expect(navCurrent('settings', 'program')).toBeUndefined();
  });
});
