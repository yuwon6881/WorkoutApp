import { createPortal } from 'react-dom';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { Button } from './Button';

export type SelectOption<T extends string | number> = {
  value: T;
  label: string;
};

export function Select<T extends string | number>({
  name,
  label,
  ariaLabel,
  value,
  onChange,
  options,
  className = '',
  disabled = false
}: {
  name?: string;
  label?: string;
  ariaLabel?: string;
  value: T;
  onChange: (val: T) => void;
  options: SelectOption<T>[];
  className?: string;
  disabled?: boolean;
}) {
  const accessibleLabel = label ?? ariaLabel ?? '';
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxRef = useRef<HTMLUListElement>(null);
  const id = useId();
  const [dropdownStyle, setDropdownStyle] = useState<CSSProperties | null>(null);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

  const [highlightedIndex, setHighlightedIndex] = useState(() => {
    const idx = options.findIndex(o => o.value === value);
    return idx >= 0 ? idx : 0;
  });

  useEffect(() => {
    if (open) {
      const idx = options.findIndex(o => o.value === value);
      setHighlightedIndex(idx >= 0 ? idx : 0);
    }
  }, [open, value, options]);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (containerRef.current && !containerRef.current.contains(target) && !listboxRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => {
      document.removeEventListener('mousedown', handleClick);
    };
  }, [open]);

  useEffect(() => {
    if (open && listboxRef.current) {
      const item = listboxRef.current.children[highlightedIndex] as HTMLElement | undefined;
      item?.scrollIntoView({ block: 'nearest' });
    }
  }, [open, highlightedIndex]);

  const positionDropdown = useCallback(() => {
    const trigger = triggerRef.current;
    const listbox = listboxRef.current;
    if (!trigger || !listbox) return;

    const triggerRect = trigger.getBoundingClientRect();
    const viewportPadding = 8;
    const availableBelow = Math.max(0, window.innerHeight - triggerRect.bottom - viewportPadding);
    const availableAbove = Math.max(0, triggerRect.top - viewportPadding);
    const maxHeight = Math.min(260, Math.max(120, Math.max(availableBelow, availableAbove)));
    const measuredHeight = Math.min(listbox.scrollHeight, maxHeight);
    const opensAbove = availableBelow < measuredHeight && availableAbove > availableBelow;

    setDropdownStyle({
      position: 'fixed',
      left: `${Math.max(viewportPadding, triggerRect.left)}px`,
      top: `${opensAbove
        ? Math.max(viewportPadding, triggerRect.top - measuredHeight - 5)
        : Math.min(window.innerHeight - measuredHeight - viewportPadding, triggerRect.bottom + 5)}px`,
      width: `${triggerRect.width}px`,
      maxHeight: `${maxHeight}px`
    });
  }, []);

  // Portaling the listbox keeps a long option list above clipped cards, drawers and bottom sheets.
  // Its fixed position is refreshed while the page or modal scrolls so it remains attached to the
  // trigger instead of becoming a detached overlay.
  useLayoutEffect(() => {
    if (!open) {
      setPortalTarget(null);
      setDropdownStyle(null);
      return;
    }
    const dialog = containerRef.current?.closest('dialog')
      ?? triggerRef.current?.closest('dialog')
      ?? [...document.querySelectorAll<HTMLDialogElement>('dialog[open]')].at(-1);
    setPortalTarget((dialog as HTMLElement | null) ?? document.body);
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !portalTarget) return;
    positionDropdown();
    const handleScroll = () => positionDropdown();
    window.addEventListener('resize', handleScroll);
    document.addEventListener('scroll', handleScroll, true);
    return () => {
      window.removeEventListener('resize', handleScroll);
      document.removeEventListener('scroll', handleScroll, true);
    };
  }, [open, portalTarget, positionDropdown, options.length]);

  const selectedOption = options.find(o => o.value === value) ?? options[0];

  const handleKeyDown = (e: ReactKeyboardEvent) => {
    if (disabled) return;
    if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
      } else {
        setHighlightedIndex(prev => (prev + 1 < options.length ? prev + 1 : 0));
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
      } else {
        setHighlightedIndex(prev => (prev - 1 >= 0 ? prev - 1 : options.length - 1));
      }
    } else if (e.key === 'Home') {
      if (open) {
        e.preventDefault();
        setHighlightedIndex(0);
      }
    } else if (e.key === 'End') {
      if (open) {
        e.preventDefault();
        setHighlightedIndex(options.length - 1);
      }
    } else if (e.key === 'Enter' || e.key === ' ') {
      if (open) {
        e.preventDefault();
        const chosen = options[highlightedIndex];
        if (chosen) {
          onChange(chosen.value);
          setOpen(false);
          triggerRef.current?.focus();
        }
      }
    } else if (e.key === 'Tab') {
      if (open) {
        setOpen(false);
      }
    }
  };

  return (
    <div ref={containerRef} className={`custom-select-wrap ${className}`.trim()} onKeyDown={handleKeyDown}>
      {/* A mirror of the value for form semantics, not a second control: the trigger below is the
          one thing that carries this field's accessible name, so a screen reader is offered one
          control rather than two identically named ones. */}
      <select
        name={name}
        aria-hidden="true"
        value={String(value)}
        disabled={disabled}
        onChange={e => {
          const raw = e.target.value;
          const matched = options.find(o => String(o.value) === raw);
          if (matched) onChange(matched.value);
        }}
        className="sr-only"
        tabIndex={-1}
      >
        {options.map(o => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>

      <Button
        ref={triggerRef}
        presentation="plain"
        type="button"
        aria-label={accessibleLabel}
        className={`custom-select-trigger ${open ? 'active' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen(prev => !prev)}
      >
        <span className="custom-select-text">{selectedOption?.label}</span>
        <ChevronDown size={16} className={`custom-select-chevron ${open ? 'rotated' : ''}`} />
      </Button>

      {open && portalTarget && createPortal(
        <ul ref={listboxRef} className="custom-select-dropdown" style={dropdownStyle ?? { visibility: 'hidden' }} role="listbox" aria-label={accessibleLabel}>
          {options.map((o, idx) => {
            const isSelected = o.value === value;
            const isHighlighted = idx === highlightedIndex;
            return (
              <li
                key={String(o.value)}
                id={`${id}-opt-${idx}`}
                role="option"
                aria-selected={isSelected}
                className={`custom-select-item ${isSelected ? 'selected' : ''} ${isHighlighted ? 'highlighted' : ''}`}
                onMouseEnter={() => setHighlightedIndex(idx)}
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                  triggerRef.current?.focus();
                }}
              >
                <span>{o.label}</span>
                {isSelected && <Check size={15} className="custom-select-check accent" />}
              </li>
            );
          })}
        </ul>,
        portalTarget
      )}
    </div>
  );
}
