import { createPortal } from 'react-dom';
import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { Button } from './Button';
import { useAnchoredLayer } from './useAnchoredLayer';
import { usePickerSheet } from './usePickerSheet';

export type SelectOption<T extends string | number> = {
  value: T;
  label: string;
};

export function Select<T extends string | number>({
  name,
  label,
  ariaLabel,
  title,
  icon,
  value,
  onChange,
  options,
  className = '',
  disabled = false,
  displayLabel,
  fitMenuToOptions = false
}: {
  name?: string;
  label?: string;
  ariaLabel?: string;
  title?: string;
  icon?: React.ReactNode;
  value: T;
  onChange: (val: T) => void;
  options: SelectOption<T>[];
  className?: string;
  disabled?: boolean;
  /** Trigger text when it should say more than the option does, such as "Warm-up 2". */
  displayLabel?: string;
  /** Sizes the menu to its longest option on one line instead of to a trigger narrower than it. */
  fitMenuToOptions?: boolean;
}) {
  const accessibleLabel = label ?? ariaLabel ?? '';
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxRef = useRef<HTMLUListElement>(null);
  const id = useId();

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
    document.addEventListener('pointerdown', handleClick);
    return () => {
      document.removeEventListener('pointerdown', handleClick);
    };
  }, [open]);

  useEffect(() => {
    if (open && listboxRef.current) {
      const item = listboxRef.current.children[highlightedIndex] as HTMLElement | undefined;
      item?.scrollIntoView({ block: 'nearest' });
    }
  }, [open, highlightedIndex]);

  const { portalTarget, style: dropdownStyle } = useAnchoredLayer({
    open,
    triggerRef,
    layerRef: listboxRef,
    matchTriggerWidth: !fitMenuToOptions,
    minWidth: fitMenuToOptions ? 140 : 120,
    maxWidth: 260,
    maxHeight: 260,
    offset: 5,
    dependencies: [options.length]
  });

  const sheet = usePickerSheet(open, () => setOpen(false));
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

    const controlName = name ?? (label ? label.toLowerCase().replace(/[^a-z0-9]+/g, '-') : (ariaLabel ? ariaLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-') : id));

    return (
      <div ref={containerRef} className={`custom-select-wrap ${className}`.trim()} onKeyDown={handleKeyDown}>
        {/* A mirror of the value for form semantics, not a second control: the trigger below is the
            one thing that carries this field's accessible name, so a screen reader is offered one
            control rather than two identically named ones. */}
        <select
          name={controlName}
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
        title={title}
        aria-label={accessibleLabel}
        className={`custom-select-trigger ${open ? 'active' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen(prev => !prev)}
      >
        <div className="custom-select-content">
          {icon && <span className="custom-select-icon" aria-hidden="true">{icon}</span>}
          <span className="custom-select-text">{displayLabel ?? selectedOption?.label}</span>
        </div>
        <ChevronDown size={16} className={`custom-select-chevron ${open ? 'rotated' : ''}`} />
      </Button>

      {open && portalTarget && sheet && createPortal(<div className="picker-sheet-backdrop" aria-hidden="true" />, portalTarget)}
      {open && portalTarget && createPortal(
        <ul ref={listboxRef} className={['custom-select-dropdown', sheet && 'picker-sheet', fitMenuToOptions && 'fit-options'].filter(Boolean).join(' ')} style={sheet ? undefined : dropdownStyle ?? { visibility: 'hidden' }} role="listbox" aria-label={accessibleLabel}>
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

export function MultiSelect<T extends string>({
  name,
  label,
  ariaLabel,
  title,
  icon,
  values,
  onChange,
  options,
  placeholder = 'None',
  className = '',
  disabled = false,
  fitMenuToOptions = false
}: {
  name?: string;
  label?: string;
  ariaLabel?: string;
  title?: string;
  icon?: React.ReactNode;
  values: T[];
  onChange: (vals: T[]) => void;
  options: SelectOption<T>[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  fitMenuToOptions?: boolean;
}) {
  const accessibleLabel = label ?? ariaLabel ?? '';
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxRef = useRef<HTMLUListElement>(null);
  const id = useId();
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  useEffect(() => {
    if (open) {
      const firstSelected = options.findIndex(o => values.includes(o.value));
      setHighlightedIndex(firstSelected >= 0 ? firstSelected : 0);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (containerRef.current && !containerRef.current.contains(target) && !listboxRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', handleClick);
    return () => document.removeEventListener('pointerdown', handleClick);
  }, [open]);

  useEffect(() => {
    if (open && listboxRef.current) {
      const item = listboxRef.current.children[highlightedIndex] as HTMLElement | undefined;
      item?.scrollIntoView({ block: 'nearest' });
    }
  }, [open, highlightedIndex]);

  const { portalTarget, style: dropdownStyle } = useAnchoredLayer({
    open,
    triggerRef,
    layerRef: listboxRef,
    matchTriggerWidth: !fitMenuToOptions,
    minWidth: fitMenuToOptions ? 140 : 120,
    maxWidth: 260,
    maxHeight: 260,
    offset: 5,
    dependencies: [options.length]
  });

  const sheet = usePickerSheet(open, () => setOpen(false));
  const selectedSet = new Set(values);
  const selectedLabels = options.filter(o => selectedSet.has(o.value)).map(o => o.label);
  const summaryText = selectedLabels.length > 0 ? selectedLabels.join(', ') : placeholder;

  function toggleValue(val: T) {
    const next = new Set(values);
    if (next.has(val)) next.delete(val);
    else next.add(val);
    onChange(options.map(o => o.value).filter(v => next.has(v)));
  }

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
      if (!open) setOpen(true);
      else setHighlightedIndex(prev => (prev + 1 < options.length ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) setOpen(true);
      else setHighlightedIndex(prev => (prev - 1 >= 0 ? prev - 1 : options.length - 1));
    } else if (e.key === 'Home' && open) {
      e.preventDefault();
      setHighlightedIndex(0);
    } else if (e.key === 'End' && open) {
      e.preventDefault();
      setHighlightedIndex(options.length - 1);
    } else if ((e.key === 'Enter' || e.key === ' ') && open) {
      e.preventDefault();
      const chosen = options[highlightedIndex];
      if (chosen) toggleValue(chosen.value);
    } else if (e.key === 'Tab' && open) {
      setOpen(false);
    }
  };

  const controlName = name ?? (label ? label.toLowerCase().replace(/[^a-z0-9]+/g, '-') : (ariaLabel ? ariaLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-') : id));

  return (
    <div ref={containerRef} className={`custom-select-wrap ${className}`.trim()} onKeyDown={handleKeyDown}>
      <input type="hidden" name={controlName} value={values.join(',')} disabled={disabled} />
      <Button
        ref={triggerRef}
        presentation="plain"
        type="button"
        title={title ?? (selectedLabels.length > 0 ? summaryText : undefined)}
        aria-label={accessibleLabel}
        className={`custom-select-trigger ${open ? 'active' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen(prev => !prev)}
      >
        <div className="custom-select-content">
          {icon && <span className="custom-select-icon" aria-hidden="true">{icon}</span>}
          <span className="custom-select-text">{summaryText}</span>
        </div>
        <ChevronDown size={16} className={`custom-select-chevron ${open ? 'rotated' : ''}`} />
      </Button>

      {open && portalTarget && sheet && createPortal(<div className="picker-sheet-backdrop" aria-hidden="true" />, portalTarget)}
      {open && portalTarget && createPortal(
        <ul ref={listboxRef} className={['custom-select-dropdown', sheet && 'picker-sheet', fitMenuToOptions && 'fit-options'].filter(Boolean).join(' ')} style={sheet ? undefined : dropdownStyle ?? { visibility: 'hidden' }} role="listbox" aria-multiselectable="true" aria-label={accessibleLabel}>
          {options.map((o, idx) => {
            const isSelected = selectedSet.has(o.value);
            const isHighlighted = idx === highlightedIndex;
            return (
              <li
                key={String(o.value)}
                id={`${id}-opt-${idx}`}
                role="option"
                aria-selected={isSelected}
                className={`custom-select-item ${isSelected ? 'selected' : ''} ${isHighlighted ? 'highlighted' : ''}`}
                onMouseEnter={() => setHighlightedIndex(idx)}
                onClick={() => toggleValue(o.value)}
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
