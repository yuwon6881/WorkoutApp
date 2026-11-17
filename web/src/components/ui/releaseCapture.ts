/// Lets go of a pointer the element still holds. A touch cut off by the screen turning off can end
/// without a pointerup or pointercancel reaching the page, and a capture left behind keeps routing
/// that pointer's later taps (and their clicks) to the capturing element instead of the field under
/// the finger, until the element is rebuilt.
export function releaseCapture(element: Element | null | undefined, pointerId: number | undefined) {
  if (!element || pointerId === undefined) return;
  try {
    if (element.hasPointerCapture?.(pointerId)) element.releasePointerCapture?.(pointerId);
  } catch {
    // The browser already let go of it.
  }
}

/// Runs `onInterrupted` when the page is hidden or loses the foreground, which is when a gesture in
/// flight can no longer be finished by its own pointer events.
export function onGestureInterrupted(onInterrupted: () => void): () => void {
  const hidden = () => { if (document.visibilityState === 'hidden') onInterrupted(); };
  document.addEventListener('visibilitychange', hidden);
  window.addEventListener('pagehide', onInterrupted);
  return () => {
    document.removeEventListener('visibilitychange', hidden);
    window.removeEventListener('pagehide', onInterrupted);
  };
}
