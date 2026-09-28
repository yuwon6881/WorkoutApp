import { describe, expect, it } from 'vitest';
import { modalityForEvent } from './inputModality';

describe('modalityForEvent', () => {
  it('treats a pointer press as pointer input', () => {
    expect(modalityForEvent({ type: 'pointerdown' })).toBe('pointer');
  });

  it('treats navigation and typing keys as keyboard input', () => {
    expect(modalityForEvent({ type: 'keydown', key: 'Tab' })).toBe('keyboard');
    expect(modalityForEvent({ type: 'keydown', key: 'ArrowRight' })).toBe('keyboard');
    expect(modalityForEvent({ type: 'keydown', key: 'Enter' })).toBe('keyboard');
    expect(modalityForEvent({ type: 'keydown', key: 'a' })).toBe('keyboard');
  });

  it('ignores lone modifiers used by operating-system shortcuts', () => {
    for (const key of ['Shift', 'Control', 'Alt', 'Meta', 'OS', 'CapsLock']) {
      expect(modalityForEvent({ type: 'keydown', key })).toBeNull();
    }
  });

  it('ignores unrelated events', () => {
    expect(modalityForEvent({ type: 'keyup', key: 'Tab' })).toBeNull();
  });
});
