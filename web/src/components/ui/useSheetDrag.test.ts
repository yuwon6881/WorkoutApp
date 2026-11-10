import { afterEach, describe, expect, it, vi } from 'vitest';

const refSlots: { current: unknown }[] = [];
let refCursor = 0;

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useRef: <T>(initial: T) => {
      const index = refCursor++;
      if (!refSlots[index]) refSlots[index] = { current: initial };
      return refSlots[index] as { current: T };
    },
    useCallback: <T>(callback: T) => callback,
    useEffect: () => undefined
  };
});

vi.mock('../../lib/breakpoints', () => ({ windowTier: () => 'compact' }));
vi.mock('../../lib/platform', () => ({ haptic: vi.fn() }));

import { useSheetDrag } from './useSheetDrag';

function createDialog(reducedMotion = true) {
  return {
    style: { transition: '', transform: '' },
    offsetHeight: 600,
    getBoundingClientRect: () => ({ top: 100 }),
    setPointerCapture: vi.fn(),
    matchMedia: reducedMotion
  };
}

function targetNode(onHandle: boolean, interactive = false) {
  return {
    closest: (selector: string) => {
      if (selector.includes('dialog > header')) return onHandle ? {} : null;
      if (selector.includes('button')) return interactive ? {} : null;
      return null;
    }
  } as unknown as HTMLElement;
}

function pointer(type: string, clientY: number, timeStamp: number, target = targetNode(true), pointerId = 1) {
  return {
    type,
    button: 0,
    pointerId,
    clientY,
    timeStamp,
    target
  } as unknown as import('react').PointerEvent<HTMLDialogElement>;
}

function mountHook(dialog: ReturnType<typeof createDialog>, onDismiss: () => void, reducedMotion = true) {
  vi.stubGlobal('window', {
    matchMedia: () => ({ matches: reducedMotion })
  });
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 1; });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  refCursor = 0;
  return useSheetDrag({ current: dialog as unknown as HTMLDialogElement }, onDismiss);
}

afterEach(() => {
  refSlots.length = 0;
  refCursor = 0;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useSheetDrag', () => {
  it('dismisses when a held touch has pre-slop motion right before a fast release flick', () => {
    const dialog = createDialog(true);
    const onDismiss = vi.fn();
    const handlers = mountHook(dialog, onDismiss);

    handlers.onPointerDown(pointer('pointerdown', 100, 0));
    // Finger rests ~95 ms before nudging 3px and flicking past 6px threshold in one move.
    handlers.onPointerMove(pointer('pointermove', 103, 95));
    handlers.onPointerMove(pointer('pointermove', 142, 110));
    handlers.onPointerUp(pointer('pointerup', 142, 112));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('expires release velocity and springs back after pausing past the window', () => {
    const dialog = createDialog(false);
    const onDismiss = vi.fn();
    const handlers = mountHook(dialog, onDismiss, false);

    handlers.onPointerDown(pointer('pointerdown', 100, 0));
    handlers.onPointerMove(pointer('pointermove', 135, 16));
    handlers.onPointerMove(pointer('pointermove', 175, 32));
    // Pause > 60 ms at offset 75 px (< 140 px distance threshold) before lifting.
    handlers.onPointerUp(pointer('pointerup', 175, 140));

    expect(onDismiss).not.toHaveBeenCalled();
    expect(dialog.style.transform).toBe('');
    expect(dialog.style.transition).toContain('transform');
  });

  it('ignores pointer starts inside interactive controls on the sheet header', () => {
    const dialog = createDialog(true);
    const onDismiss = vi.fn();
    const handlers = mountHook(dialog, onDismiss);

    handlers.onPointerDown(pointer('pointerdown', 100, 0, targetNode(true, true)));
    handlers.onPointerMove(pointer('pointermove', 280, 30));
    handlers.onPointerUp(pointer('pointerup', 280, 35));

    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('ignores a secondary pointer during an active sheet drag', () => {
    const dialog = createDialog(true);
    const onDismiss = vi.fn();
    const handlers = mountHook(dialog, onDismiss);

    handlers.onPointerDown(pointer('pointerdown', 100, 0, targetNode(true), 1));
    handlers.onPointerMove(pointer('pointermove', 200, 16, targetNode(true), 1));
    handlers.onPointerDown(pointer('pointerdown', 120, 20, targetNode(true), 2));
    handlers.onPointerCancel(pointer('pointercancel', 120, 24, targetNode(true), 2));
    handlers.onPointerUp(pointer('pointerup', 260, 32, targetNode(true), 1));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
