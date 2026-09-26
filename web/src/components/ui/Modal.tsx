import { useCallback, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button } from './Button';
import { useSheetDrag } from './useSheetDrag';
import { backStack } from '../../lib/backStack';

let openDialogs = 0;

// Native dialogs do not stop the page behind them from scrolling, so a swipe that reaches the end
// of a sheet would carry on into the tab underneath.
function lockPageScroll() {
  openDialogs += 1;
  document.documentElement.classList.add('dialog-open');
  return () => {
    openDialogs = Math.max(0, openDialogs - 1);
    if (openDialogs === 0) document.documentElement.classList.remove('dialog-open');
  };
}

export function Modal({ title, children, onClose, wide = false, headless = false, className = '' }: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  /** The content supplies its own header, including a way to close. The title stays the dialog's name. */
  headless?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const pointerStartedOnBackdrop = useRef(false);

  const close = useCallback(() => {
    const el = ref.current;
    if (el?.open) el.close();
    onClose();
  }, [onClose]);
  const latestClose = useRef(close);
  latestClose.current = close;

  useEffect(() => {
    const el = ref.current;
    el?.showModal();
    // The close button is the first focusable control; landing there reads as "close" before the
    // content. Focus the dialog itself so its name is announced and nothing is pressed by accident.
    if (el && document.activeElement?.closest('dialog > header') && !el.querySelector('[autofocus]')) el.focus();
    const unlock = lockPageScroll();
    // Back (the Android gesture, or the browser button) closes the top dialog first.
    const leaveBackStack = backStack()?.openOverlay(() => latestClose.current());
    return () => { leaveBackStack?.(); unlock(); el?.close(); };
  }, []);

  const drag = useSheetDrag(ref, close);

  const handlePointerDown = (e: React.PointerEvent<HTMLDialogElement>) => {
    pointerStartedOnBackdrop.current = e.target === ref.current;
    drag.onPointerDown(e);
  };

  const handleClick = (e: React.MouseEvent<HTMLDialogElement>) => {
    const el = ref.current;
    if (!el || e.target !== el || !pointerStartedOnBackdrop.current) return;
    const rect = el.getBoundingClientRect();
    const isOutside = (
      e.clientX < rect.left ||
      e.clientX > rect.right ||
      e.clientY < rect.top ||
      e.clientY > rect.bottom
    );
    if (isOutside) close();
  };

  return <dialog ref={ref} tabIndex={-1} className={`modal ${wide ? 'wide' : ''} ${headless ? 'headless' : ''} ${className}`.trim()}
    onPointerDown={handlePointerDown} onPointerMove={drag.onPointerMove} onPointerUp={drag.onPointerUp} onPointerCancel={drag.onPointerCancel}
    onClick={handleClick} onCancel={e => { e.preventDefault(); close(); }} aria-label={title}>
    {!headless && <header><h2 title={title}>{title}</h2><Button variant="tertiary" aria-label="Close dialog" onClick={close}><X size={20} /></Button></header>}
    {children}
  </dialog>;
}
