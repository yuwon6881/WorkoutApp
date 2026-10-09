import { createContext, useCallback, useContext, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button } from './Button';
import { useSheetDrag } from './useSheetDrag';
import { backStack } from '../../lib/backStack';

let openDialogs = 0;
// Longer than any exit animation, so a missed animationend (a hidden tab) never strands a dialog.
const EXIT_FALLBACK_MS = 420;

const ModalDismiss = createContext<(() => void) | null>(null);

/// The enclosing dialog's own close, with its exit motion, for content that draws its own header.
export function useModalDismiss() {
  return useContext(ModalDismiss);
}

function prefersReducedMotion() {
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

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

export function Modal({ title, children, onClose, wide = false, headless = false, className = '', headerActions, animateExit = false }: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  /** The content supplies its own header, including a way to close. The title stays the dialog's name. */
  headless?: boolean;
  className?: string;
  headerActions?: ReactNode;
  /** Plays the stylesheet's `[data-leaving]` animation before the owner is asked to close. */
  animateExit?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const pointerStartedOnBackdrop = useRef(false);
  const leaving = useRef(false);

  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  // The owner decides whether the dialog closes, by unmounting it; unmounting closes the native
  // dialog. A guarded owner (unsaved changes) may keep it, so the dialog must stay shown and a sheet
  // dragged away must come back rather than leave an invisible dialog holding the page's scroll lock.
  const closeNow = useCallback(() => {
    leaving.current = false;
    onClose();
    window.requestAnimationFrame(() => {
      const el = ref.current;
      if (!mounted.current || !el) return;
      if (!el.open) el.showModal();
      delete el.dataset.leaving;
      el.style.transition = '';
      el.style.transform = '';
    });
  }, [onClose]);

  // The exit plays first and the owner hears about it once it ends, so the dialog leaves the way it
  // arrived instead of vanishing. Repeated requests while it leaves are the same request.
  const close = useCallback(() => {
    const el = ref.current;
    if (!animateExit || !el || prefersReducedMotion()) { closeNow(); return; }
    if (leaving.current) return;
    leaving.current = true;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      el.removeEventListener('animationend', onEnd);
      window.clearTimeout(fallback);
      closeNow();
    };
    const onEnd = (event: AnimationEvent) => { if (event.target === el) finish(); };
    const fallback = window.setTimeout(finish, EXIT_FALLBACK_MS);
    el.addEventListener('animationend', onEnd);
    el.dataset.leaving = '';
  }, [animateExit, closeNow]);
  const latestClose = useRef(close);
  latestClose.current = close;

  useEffect(() => {
    const el = ref.current;
    el?.showModal();
    // The close button is the first focusable control; landing there reads as "close" before the
    // content. Focus the dialog itself so its name is announced and nothing is pressed by accident.
    if (el && document.activeElement?.closest('dialog > header') && !el.querySelector('[autofocus], .issue-focus')) el.focus();
    const unlock = lockPageScroll();
    // Back (the Android gesture, or the browser button) closes the top dialog first.
    const leaveBackStack = backStack()?.openOverlay(() => latestClose.current());
    return () => { leaveBackStack?.(); unlock(); el?.close(); };
  }, []);

  // A dragged sheet has already left the screen under the finger; it must not play the exit again.
  const drag = useSheetDrag(ref, closeNow);

  const handlePointerDown = (e: React.PointerEvent<HTMLDialogElement>) => {
    const el = ref.current;
    if (el && e.target === el) {
      const rect = el.getBoundingClientRect();
      pointerStartedOnBackdrop.current = (
        e.clientX < rect.left ||
        e.clientX > rect.right ||
        e.clientY < rect.top ||
        e.clientY > rect.bottom
      );
    } else {
      pointerStartedOnBackdrop.current = false;
    }
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
    onClick={handleClick} onCancel={e => {
      e.preventDefault();
      // React bubbles cancel events through nested dialogs; Escape belongs to the top dialog.
      e.stopPropagation();
      if (e.currentTarget.dataset.tooltipEscapeHandled === 'true') {
        delete e.currentTarget.dataset.tooltipEscapeHandled;
        const help = e.currentTarget.querySelector<HTMLButtonElement>('.info-tooltip-trigger');
        window.requestAnimationFrame(() => help?.focus());
        return;
      }
      close();
    }} aria-label={title}>
    {!headless && <header>
      <h2 title={title}>{title}</h2>
      <div className="modal-header-actions">
        {headerActions}
        <Button variant="tertiary" aria-label="Close dialog" onClick={close}><X size={20} /></Button>
      </div>
    </header>}
    <ModalDismiss.Provider value={close}>{children}</ModalDismiss.Provider>
  </dialog>;
}
