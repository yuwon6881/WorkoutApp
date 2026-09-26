import { useEffect } from 'react';

// Android Chrome resizes the page for the on-screen keyboard (index.html asks it to), but iOS
// overlays the keyboard instead. Both report it through visualViewport, so the shell publishes
// one signal: html[data-keyboard="open"] plus --keyboard-inset. CSS uses it to hide bottom
// chrome that would otherwise sit on the keyboard, and a focused field is kept in view.
const OPEN_THRESHOLD_PX = 120;
const SCROLL_AFTER_MS = 250;

export function useKeyboardInset() {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const root = document.documentElement;
    let scrollTimer: ReturnType<typeof setTimeout> | undefined;
    // When the page itself is resized for the keyboard (Android), innerHeight shrinks too, so the
    // keyboard shows as a drop from the tallest viewport seen at this width.
    let tallest = { width: window.innerWidth, height: viewport.height };

    const update = () => {
      if (window.innerWidth !== tallest.width) tallest = { width: window.innerWidth, height: viewport.height };
      tallest.height = Math.max(tallest.height, viewport.height);
      const overlaid = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      const shrunk = tallest.height - viewport.height;
      const inset = Math.max(overlaid, shrunk);
      const open = inset > OPEN_THRESHOLD_PX && isTextEntry(document.activeElement);
      root.style.setProperty('--keyboard-inset', `${Math.round(inset)}px`);
      if (open) root.dataset.keyboard = 'open';
      else delete root.dataset.keyboard;
    };

    const keepFocusedFieldVisible = (event: FocusEvent) => {
      if (!isTextEntry(event.target)) return;
      clearTimeout(scrollTimer);
      // Wait for the keyboard to finish opening, then centre the field if it ended up hidden.
      scrollTimer = setTimeout(() => {
        const field = event.target as HTMLElement;
        const box = field.getBoundingClientRect();
        if (box.top < 0 || box.bottom > viewport.height) field.scrollIntoView({ block: 'center' });
      }, SCROLL_AFTER_MS);
    };

    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    document.addEventListener('focusin', keepFocusedFieldVisible);
    update();
    return () => {
      clearTimeout(scrollTimer);
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
      document.removeEventListener('focusin', keepFocusedFieldVisible);
      delete root.dataset.keyboard;
    };
  }, []);
}

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLTextAreaElement || target.isContentEditable) return true;
  return target instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'submit', 'range', 'file', 'hidden'].includes(target.type);
}
