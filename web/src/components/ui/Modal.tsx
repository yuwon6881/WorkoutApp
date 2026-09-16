import { useCallback, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button } from './Button';
import { useReducedMotion } from './Motion';

const ease = 'cubic-bezier(.2,.8,.2,1)';

export function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => { const el = ref.current; el?.showModal(); return () => el?.close(); }, []);

  const animateClose = useCallback(() => {
    if (reduced) { onClose(); return; }
    const el = ref.current;
    if (!el) { onClose(); return; }
    const anim = el.animate(
      [{ opacity: 1 }, { opacity: 0 }],
      { duration: 120, easing: ease, fill: 'forwards' }
    );
    anim.onfinish = onClose;
  }, [onClose, reduced]);

  return <dialog ref={ref} className={`modal ${wide ? 'wide' : ''}`} onCancel={e => { e.preventDefault(); animateClose(); }} aria-label={title}>
    <header><h2>{title}</h2><Button variant="tertiary" aria-label="Close dialog" onClick={animateClose}><X size={20} /></Button></header>
    {children}
  </dialog>;
}
