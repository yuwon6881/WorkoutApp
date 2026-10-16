import { describe, expect, it } from 'vitest';
import { fittingCount } from './fittingCount';

describe('fittingCount', () => {
  it('shows every name when the whole list fits', () => {
    expect(fittingCount([60, 60, 60], 200, 10, 50)).toBe(3);
  });

  it('keeps room for the more label when names are left out', () => {
    // Three names fit on their own (200), but not with a "+2 more" label beside them.
    expect(fittingCount([60, 60, 60, 60, 60], 230, 10, 50)).toBe(2);
  });

  it('always shows the first name, which shortens instead', () => {
    expect(fittingCount([400, 60], 120, 10, 50)).toBe(1);
  });

  it('shows nothing for a day without exercises', () => {
    expect(fittingCount([], 300, 10, 50)).toBe(0);
  });
});
