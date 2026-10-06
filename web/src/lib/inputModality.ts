export type InputModality = 'pointer' | 'keyboard';

// A lone modifier is how operating-system shortcuts start (Win+Shift+S for a screenshot, Alt+Tab),
// not how anyone moves through the page. Browsers still promote whatever a click focused to
// keyboard focus on such a press, so these keys must not count as keyboard use.
const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'AltGraph', 'Meta', 'OS', 'Super', 'Hyper', 'Fn', 'FnLock', 'CapsLock', 'NumLock', 'ScrollLock']);

export function modalityForEvent(event: { type: string; key?: string }): InputModality | null {
  if (event.type === 'pointerdown') return 'pointer';
  if (event.type === 'keydown') return event.key && MODIFIER_KEYS.has(event.key) ? null : 'keyboard';
  return null;
}

/** Prevents mouse wheel scrolling from changing values on number inputs across the entire application. */
export function preventNumberInputScroll(): () => void {
  const handleWheel = (event: WheelEvent) => {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.type === 'number') {
      target.blur();
    }
  };
  window.addEventListener('wheel', handleWheel, { passive: true });
  return () => window.removeEventListener('wheel', handleWheel);
}

/** Records the last meaningful input on the root element so focus rings follow keyboard use only. */
export function trackInputModality(root: HTMLElement = document.documentElement): () => void {
  preventNumberInputScroll();
  const record = (event: Event) => {
    const modality = modalityForEvent({ type: event.type, key: (event as KeyboardEvent).key });
    if (modality && root.dataset.inputModality !== modality) root.dataset.inputModality = modality;
  };
  window.addEventListener('pointerdown', record, { capture: true, passive: true });
  window.addEventListener('keydown', record, { capture: true });
  return () => {
    window.removeEventListener('pointerdown', record, { capture: true });
    window.removeEventListener('keydown', record, { capture: true });
  };
}
