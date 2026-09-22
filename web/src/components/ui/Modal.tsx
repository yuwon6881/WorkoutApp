import { useCallback, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button } from './Button';

export function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const pointerStartedOnBackdrop = useRef(false);

  useEffect(() => { const el = ref.current; el?.showModal(); return () => el?.close(); }, []);

  const close = useCallback(() => {
    const el = ref.current;
    if (el?.open) el.close();
    onClose();
  }, [onClose]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDialogElement>) => {
    pointerStartedOnBackdrop.current = e.target === ref.current;
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

  return <dialog ref={ref} className={`modal ${wide ? 'wide' : ''}`} onPointerDown={handlePointerDown} onClick={handleClick} onCancel={e => { e.preventDefault(); close(); }} aria-label={title}>
    <header><h2 title={title}>{title}</h2><Button variant="tertiary" aria-label="Close dialog" onClick={close}><X size={20} /></Button></header>
    {children}
  </dialog>;
}
