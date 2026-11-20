import { beforeAll, describe, expect, it } from 'vitest';

// No DOM library runs these tests, so a minimal window, document and element stand in.
const captured = new Set<number>();
class FakeElement extends EventTarget {
  setPointerCapture(id: number) { captured.add(id); }
  hasPointerCapture(id: number) { return captured.has(id); }
  releasePointerCapture(id: number) { captured.delete(id); }
}
const fakeWindow = new EventTarget();
const fakeDocument = new EventTarget();

function fire(target: EventTarget, type: string, extra: Record<string, unknown> = {}) {
  target.dispatchEvent(Object.assign(new Event(type), extra));
}

let guard: typeof import('./pointerCaptureGuard');

beforeAll(async () => {
  Object.assign(globalThis, { Element: FakeElement, window: fakeWindow, document: fakeDocument });
  guard = await import('./pointerCaptureGuard');
  guard.installPointerCaptureGuard();
});

describe('pointer capture guard', () => {
  it('releases a capture left behind when the page is hidden', () => {
    captured.clear();
    new FakeElement().setPointerCapture(7);
    expect(captured.has(7)).toBe(true);
    fire(fakeDocument, 'visibilitychange');
    expect(captured.has(7)).toBe(false);
  });

  it('releases a capture left behind when a new first touch starts, but not for a second finger', () => {
    captured.clear();
    new FakeElement().setPointerCapture(7);
    fire(fakeWindow, 'pointerdown', { pointerId: 8, isPrimary: false });
    expect(captured.has(7)).toBe(true);
    fire(fakeWindow, 'pointerdown', { pointerId: 8, isPrimary: true });
    expect(captured.has(7)).toBe(false);
  });

  it('leaves a capture alone once its own touch ended', () => {
    captured.clear();
    new FakeElement().setPointerCapture(7);
    fire(fakeWindow, 'pointerup', { pointerId: 7 });
    fire(fakeDocument, 'visibilitychange');
    expect(captured.has(7)).toBe(true);
  });
});
