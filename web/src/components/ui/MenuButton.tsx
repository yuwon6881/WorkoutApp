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
import { createPortal } from 'react-dom';
import { ChevronDown, MoreVertical } from 'lucide-react';
import { Button, type ButtonVariant } from './Button';
import { useAnchoredLayer } from './useAnchoredLayer';

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
  variant = 'secondary',
  portal = false
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
  portal?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const { portalTarget, style } = useAnchoredLayer({
    open: open && portal,
    triggerRef,
    layerRef: menuRef,
    align,
    minWidth: 210,
    maxWidth: 280,
    maxHeight: 300,
    offset: 4
  });

  const close = useCallback((restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!wrapRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false);
      }
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

  return <div className={`ui-menu ${align === 'start' ? 'ui-menu-start' : ''}`.trim()} ref={wrapRef}>
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
    {open && !portal && (
      <div
        ref={menuRef}
        id={menuId}
        role="menu"
        aria-label={label}
        className={`ui-menu-dropdown ${menuClassName}`.trim()}
      >
        <MenuCloseContext.Provider value={close}>{children}</MenuCloseContext.Provider>
      </div>
    )}
    {open && portal && portalTarget && createPortal(
      <div
        ref={menuRef}
        id={menuId}
        role="menu"
        aria-label={label}
        style={style ?? { visibility: 'hidden' }}
        className={`ui-menu-dropdown ${menuClassName}`.trim()}
      >
        <MenuCloseContext.Provider value={close}>{children}</MenuCloseContext.Provider>
      </div>,
      portalTarget
    )}
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
