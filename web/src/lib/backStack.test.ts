import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBackStack } from './backStack';

// A browser-shaped history: back() delivers popstate asynchronously, as real browsers do.
function fakeBrowser(initialPath = '/') {
  const entries: Array<{ state: unknown; path: string }> = [{ state: null, path: initialPath }];
  let index = 0;
  const listeners = new Set<(event: PopStateEvent) => void>();
  const history = {
    get state() { return entries[index].state; },
    pushState(state: unknown, _title: string, path?: string) {
      entries.splice(index + 1);
      entries.push({ state, path: path ?? entries[index].path });
      index += 1;
    },
    replaceState(state: unknown, _title: string, path?: string) {
      entries[index] = { state, path: path ?? entries[index].path };
    },
    back() {
      if (index === 0) return;
      index -= 1;
      setTimeout(() => listeners.forEach(listener => listener({ state: entries[index].state } as PopStateEvent)), 0);
    }
  };
  const target = {
    addEventListener: (_type: string, listener: (event: PopStateEvent) => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: (event: PopStateEvent) => void) => listeners.delete(listener)
  };
  return { history, target, path: () => entries[index].path, length: () => index + 1 };
}

describe('back stack', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('closes the top sheet on back, then walks back through tabs', async () => {
    const browser = fakeBrowser();
    const stack = createBackStack(browser.history as unknown as History, browser.target as unknown as Window, browser.path);
    const paths: string[] = [];
    stack.onNavigate(path => paths.push(path));
    stack.navigate('/workouts');

    const outer = vi.fn();
    const inner = vi.fn();
    const closeOuter = stack.openOverlay(outer);
    const closeInner = stack.openOverlay(inner);
    expect(browser.length()).toBe(4);

    browser.history.back();
    await vi.runAllTimersAsync();
    expect(inner).toHaveBeenCalledOnce();
    expect(outer).not.toHaveBeenCalled();
    closeInner();

    browser.history.back();
    await vi.runAllTimersAsync();
    expect(outer).toHaveBeenCalledOnce();
    closeOuter();

    browser.history.back();
    await vi.runAllTimersAsync();
    expect(browser.path()).toBe('/');
    expect(paths.at(-1)).toBe('/');
  });

  it('consumes the history entry when a sheet is closed from the interface', async () => {
    const browser = fakeBrowser();
    const stack = createBackStack(browser.history as unknown as History, browser.target as unknown as Window, browser.path);
    const onClose = vi.fn();
    const close = stack.openOverlay(onClose);
    close();
    await vi.runAllTimersAsync();
    expect(browser.length()).toBe(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('defers a new sheet until the previous sheet has given back its entry', async () => {
    const browser = fakeBrowser();
    const stack = createBackStack(browser.history as unknown as History, browser.target as unknown as Window, browser.path);
    const first = stack.openOverlay(vi.fn());
    const second = vi.fn();
    first();
    stack.openOverlay(second);
    await vi.runAllTimersAsync();
    expect(browser.length()).toBe(2);

    browser.history.back();
    await vi.runAllTimersAsync();
    expect(second).toHaveBeenCalledOnce();
  });

  it('keeps the entry of a sheet that refuses to close', async () => {
    const browser = fakeBrowser();
    const stack = createBackStack(browser.history as unknown as History, browser.target as unknown as Window, browser.path);
    const refuse = vi.fn();
    stack.openOverlay(refuse);
    browser.history.back();
    await vi.runAllTimersAsync();
    expect(refuse).toHaveBeenCalledOnce();
    expect(browser.length()).toBe(2);

    browser.history.back();
    await vi.runAllTimersAsync();
    expect(refuse).toHaveBeenCalledTimes(2);
  });

  it('treats an entry left by a sheet before a reload as a tab entry', () => {
    const browser = fakeBrowser();
    browser.history.replaceState({ overlayDepth: 2 }, '');
    createBackStack(browser.history as unknown as History, browser.target as unknown as Window, browser.path);
    expect(browser.history.state).toEqual({ overlayDepth: 0 });
  });
});
