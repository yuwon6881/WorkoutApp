import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode
} from 'react';
import { ChevronDown, MoreVertical } from 'lucide-react';
import { Button, type ButtonVariant } from './Button';

const MenuCloseContext = createContext<() => void>(() => {});

/// One overflow menu for the whole app. Actions that would otherwise crowd a toolbar live behind a
/// single trigger, so a row keeps its primary action visible and everything else one click away.
export function MenuButton({
  label,
  children,
  icon,
  triggerClassName = '',
  menuClassName = '',
  align = 'end',
  disabled = false,
  text,
  variant = 'secondary'
}: {
  label: string;
  children: ReactNode;
  icon?: ReactNode;
  triggerClassName?: string;
  menuClassName?: string;
  align?: 'start' | 'end';
  disabled?: boolean;
  text?: string;
  variant?: ButtonVariant;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  const close = useCallback((restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close(true);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [close, open]);

  return <div className="ui-menu" ref={wrapRef}>
    <Button
      ref={triggerRef}
      presentation={text ? 'control' : 'plain'}
      variant={variant}
      className={text ? triggerClassName : `ui-menu-trigger ${triggerClassName}`.trim()}
      aria-label={text ? undefined : label}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-controls={open ? menuId : undefined}
      disabled={disabled}
      onClick={() => setOpen(value => !value)}
    >
      {icon ?? (text ? null : <MoreVertical size={16} />)}
      {text}
      {text && <ChevronDown size={15} />}
    </Button>
    {open && <div id={menuId} role="menu" aria-label={label}
      className={`ui-menu-dropdown ${align === 'start' ? 'align-start' : ''} ${menuClassName}`.trim()}>
      <MenuCloseContext.Provider value={close}>{children}</MenuCloseContext.Provider>
    </div>}
  </div>;
}

export function MenuItem({
  children,
  onClick,
  disabled = false,
  destructive = false
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  const close = useContext(MenuCloseContext);
  return <Button
    presentation="plain"
    role="menuitem"
    className={`ui-menu-item ${destructive ? 'ui-menu-item-destructive' : ''}`.trim()}
    disabled={disabled}
    onClick={() => {
      close();
      onClick();
    }}
  >
    {children}
  </Button>;
}

export function MenuNote({ children }: { children: ReactNode }) {
  return <p className="ui-menu-note">{children}</p>;
}
