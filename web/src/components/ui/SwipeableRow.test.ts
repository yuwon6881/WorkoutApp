import { afterEach, describe, expect, it, vi } from 'vitest';

const stateSlots: { value: unknown; setter: (next: unknown) => void }[] = [];
const refSlots: { current: unknown }[] = [];
const layoutEffects: (() => void)[] = [];
let stateCursor = 0;
let refCursor = 0;
let stateChanges = 0;

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useState: <T>(initial: T) => {
      const index = stateCursor++;
      if (!stateSlots[index]) {
        const slot = {
          value: typeof initial === 'function' ? (initial as () => unknown)() : initial,
          setter: (next: unknown) => {
            const resolved = typeof next === 'function' ? (next as (prev: unknown) => unknown)(slot.value) : next;
            if (!Object.is(slot.value, resolved)) stateChanges++;
            slot.value = resolved;
          }
        };
        stateSlots[index] = slot;
      }
      return [stateSlots[index].value as T, stateSlots[index].setter as (next: T) => void];
    },
    useRef: <T>(initial: T) => {
      const index = refCursor++;
      if (!refSlots[index]) refSlots[index] = { current: initial };
      return refSlots[index] as { current: T };
    },
    useCallback: <T>(callback: T) => callback,
    useEffect: () => undefined,
    useLayoutEffect: (effect: () => void) => { layoutEffects.push(effect); }
  };
});

vi.mock('../../lib/breakpoints', () => ({ useWindowTier: () => 'compact' }));
vi.mock('../../lib/platform', () => ({ haptic: vi.fn() }));

import { SwipeableRow } from './SwipeableRow';

type SurfaceNode = {
  ref?: { current: unknown };
  props: Record<string, unknown>;
};

function findMobileNodes(element: unknown) {
  const root = element as { props?: { children?: unknown[] } };
  const children = Array.isArray(root?.props?.children) ? root.props.children : [root];
  for (const child of children) {
    if (!child || typeof child !== 'object') continue;
    const node = child as { props?: { className?: string; children?: unknown[] } };
    if (node.props?.className?.includes('swipeable-row-mobile')) {
      const parts = (node.props.children ?? []) as SurfaceNode[];
      return { actions: parts[0], surface: parts[1] };
    }
  }
  throw new Error('Mobile row was not rendered');
}

function renderRow(mockSurface: { style: Record<string, string> }, actionsWidth = 92) {
  stateCursor = 0;
  refCursor = 0;
  layoutEffects.length = 0;
  const element = SwipeableRow({
    adaptive: true,
    actionsWidth,
    actions: null,
    children: 'Set row'
  });
  const nodes = findMobileNodes(element);
  const surfaceRef = nodes.surface.props.ref as { current: unknown } | undefined;
  if (surfaceRef) surfaceRef.current = mockSurface;
  for (const effect of layoutEffects) effect();
  return nodes;
}

function pointerEvent(clientX: number, clientY: number, timeStamp: number, pointerId = 1) {
  return {
    pointerId,
    pointerType: 'touch',
    button: 0,
    clientX,
    clientY,
    timeStamp,
    preventDefault: vi.fn(),
    currentTarget: {
      setPointerCapture: vi.fn(),
      hasPointerCapture: () => true,
      releasePointerCapture: vi.fn()
    }
  } as unknown as import('react').PointerEvent<HTMLDivElement>;
}

afterEach(() => {
  stateSlots.length = 0;
  refSlots.length = 0;
  layoutEffects.length = 0;
  stateCursor = 0;
  refCursor = 0;
  stateChanges = 0;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('SwipeableRow drag isolation', () => {
  it('moves via requestAnimationFrame without triggering React state updates or losing drag transform on parent rerenders', () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.push(cb); return frames.length; });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    const surfaceEl = { style: { transform: '', transition: '' } };
    let nodes = renderRow(surfaceEl);
    expect(surfaceEl.style.transform).toBe('translate3d(0px, 0, 0)');
    expect(nodes.surface.props.style).toBeUndefined();

    const onDown = nodes.surface.props.onPointerDown as (e: import('react').PointerEvent<HTMLDivElement>) => void;
    const onMove = nodes.surface.props.onPointerMove as (e: import('react').PointerEvent<HTMLDivElement>) => void;
    const onUp = nodes.surface.props.onPointerUp as (e: import('react').PointerEvent<HTMLDivElement>) => void;

    stateChanges = 0;
    onDown(pointerEvent(200, 50, 0));
    // First horizontal move past slop sets dragging=true once; subsequent moves cause 0 React updates.
    onMove(pointerEvent(180, 50, 16));
    expect(stateChanges).toBe(1);
    expect(surfaceEl.style.transition).toBe('none');

    stateChanges = 0;
    for (let i = 1; i <= 5; i++) {
      onMove(pointerEvent(180 - i * 8, 50, 16 + i * 16));
    }
    expect(stateChanges).toBe(0);

    // Flush the scheduled frame and confirm JSX carries no stale transform across a parent rerender.
    while (frames.length > 0) frames.shift()!(100);
    expect(surfaceEl.style.transform).toBe('translate3d(-60px, 0, 0)');

    nodes = renderRow(surfaceEl);
    expect(nodes.surface.props.style).toBeUndefined();
    expect(surfaceEl.style.transform).toBe('translate3d(-60px, 0, 0)');

    onUp(pointerEvent(140, 50, 112));
    nodes = renderRow(surfaceEl);
    expect(nodes.surface.props['data-swipe-open']).toBe('true');
    expect(surfaceEl.style.transition).toBe('');
    expect(surfaceEl.style.transform).toBe('translate3d(-92px, 0, 0)');
  });

  it('aborts an active drag if Escape closes the open tray after settling', () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.push(cb); return frames.length; });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    const surfaceEl = { style: { transform: '', transition: '' } };
    let nodes = renderRow(surfaceEl);
    let onDown = nodes.surface.props.onPointerDown as (e: import('react').PointerEvent<HTMLDivElement>) => void;
    let onMove = nodes.surface.props.onPointerMove as (e: import('react').PointerEvent<HTMLDivElement>) => void;
    const onUp = nodes.surface.props.onPointerUp as (e: import('react').PointerEvent<HTMLDivElement>) => void;

    onDown(pointerEvent(200, 50, 0));
    onMove(pointerEvent(130, 50, 20));
    while (frames.length > 0) frames.shift()!(20);
    onUp(pointerEvent(130, 50, 30));

    nodes = renderRow(surfaceEl);
    expect(nodes.surface.props['data-swipe-open']).toBe('true');

    onDown = nodes.surface.props.onPointerDown as (e: import('react').PointerEvent<HTMLDivElement>) => void;
    onMove = nodes.surface.props.onPointerMove as (e: import('react').PointerEvent<HTMLDivElement>) => void;
    const onKeyDown = nodes.surface.props.onKeyDown as (e: { key: string; preventDefault: () => void }) => void;

    // Start dragging back toward closed, then press Escape before releasing.
    onDown(pointerEvent(130, 50, 100));
    onMove(pointerEvent(150, 50, 116));
    onKeyDown({ key: 'Escape', preventDefault: vi.fn() });

    nodes = renderRow(surfaceEl);
    expect(nodes.surface.props['data-swipe-open']).toBe('false');
    expect(surfaceEl.style.transform).toBe('translate3d(0px, 0, 0)');
    // Stray pointermove after Escape close must not resume dragging the closed row.
    stateChanges = 0;
    onMove(pointerEvent(90, 50, 132));
    expect(stateChanges).toBe(0);
    expect(surfaceEl.style.transform).toBe('translate3d(0px, 0, 0)');
  });

  it('ignores a secondary pointer while a horizontal swipe is actively tracking', () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.push(cb); return frames.length; });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    const surfaceEl = { style: { transform: '', transition: '' } };
    let nodes = renderRow(surfaceEl);
    const onDown = nodes.surface.props.onPointerDown as (e: import('react').PointerEvent<HTMLDivElement>) => void;
    const onMove = nodes.surface.props.onPointerMove as (e: import('react').PointerEvent<HTMLDivElement>) => void;
    const onUp = nodes.surface.props.onPointerUp as (e: import('react').PointerEvent<HTMLDivElement>) => void;
    const onCancel = nodes.surface.props.onPointerCancel as (e: import('react').PointerEvent<HTMLDivElement>) => void;

    onDown(pointerEvent(200, 50, 0, 1));
    onMove(pointerEvent(150, 50, 16, 1));
    // Accidental second touch arrives mid-swipe and lifts or cancels without moving.
    onDown(pointerEvent(190, 50, 20, 2));
    onUp(pointerEvent(190, 50, 24, 2));
    onCancel(pointerEvent(190, 50, 28, 3));

    // Original pointer still finishes cleanly and settles open instead of sticking in drag state.
    onUp(pointerEvent(140, 50, 32, 1));
    nodes = renderRow(surfaceEl);
    expect(nodes.surface.props['data-swipe-open']).toBe('true');
    expect(surfaceEl.style.transition).toBe('');
    expect(surfaceEl.style.transform).toBe('translate3d(-92px, 0, 0)');
  });
});
