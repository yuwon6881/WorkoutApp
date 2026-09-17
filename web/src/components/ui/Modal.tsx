import { useCallback, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button } from './Button';

export function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => { const el = ref.current; el?.showModal(); return () => el?.close(); }, []);

  const close = useCallback(() => {
    const el = ref.current;
    if (el?.open) el.close();
    onClose();
  }, [onClose]);

  return <dialog ref={ref} className={`modal ${wide ? 'wide' : ''}`} onCancel={e => { e.preventDefault(); close(); }} aria-label={title}>
    <header><h2>{title}</h2><Button variant="tertiary" aria-label="Close dialog" onClick={close}><X size={20} /></Button></header>
    {children}
  </dialog>;
}
