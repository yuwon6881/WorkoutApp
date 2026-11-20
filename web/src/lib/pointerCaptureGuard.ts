/// A touch cut off by the screen turning off can end without a pointerup, so whichever element
/// captured it keeps routing every later tap to itself and the fields under the finger stop
/// answering until the view is rebuilt. Each gesture hook releases its own capture when interrupted;
/// this is the safety net for all of them: it records every touch capture and lets go of the ones
/// left behind when the page is hidden, comes back, or a new first touch starts.
type Capture = { element: Element; pointerType: string };

const held = new Map<number, Capture>();
let installed = false;

function forget(pointerId: number) { held.delete(pointerId); }

export function releaseStaleCaptures(exceptPointerId?: number) {
  for (const [pointerId, { element }] of [...held]) {
    if (pointerId === exceptPointerId) continue;
    held.delete(pointerId);
    try {
      if (element.hasPointerCapture?.(pointerId)) element.releasePointerCapture?.(pointerId);
    } catch {
      // The browser already let go of it.
    }
  }
}

export function installPointerCaptureGuard(): void {
  if (installed || typeof window === 'undefined' || typeof Element === 'undefined') return;
  installed = true;
  const original = Element.prototype.setPointerCapture;
  if (typeof original === 'function') {
    Element.prototype.setPointerCapture = function patched(this: Element, pointerId: number) {
      original.call(this, pointerId);
      // Mouse capture ends with the button, so only touch and pen can be orphaned.
      held.set(pointerId, { element: this, pointerType: 'touch' });
    };
  }
  const release = Element.prototype.releasePointerCapture;
  if (typeof release === 'function') {
    Element.prototype.releasePointerCapture = function patched(this: Element, pointerId: number) {
      forget(pointerId);
      release.call(this, pointerId);
    };
  }
  window.addEventListener('lostpointercapture', event => forget((event as PointerEvent).pointerId), true);
  window.addEventListener('pointerup', event => forget(event.pointerId), true);
  window.addEventListener('pointercancel', event => forget(event.pointerId), true);
  // A first touch means every earlier one is over.
  window.addEventListener('pointerdown', event => {
    if (event.isPrimary !== false) releaseStaleCaptures(event.pointerId);
  }, true);
  document.addEventListener('visibilitychange', () => releaseStaleCaptures());
  window.addEventListener('pagehide', () => releaseStaleCaptures());
  window.addEventListener('pageshow', () => releaseStaleCaptures());
}
