import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { Button } from './Button';

export type SelectOption<T extends string | number> = {
  value: T;
  label: string;
};

export function Select<T extends string | number>({
  name,
  label,
  value,
  onChange,
  options,
  className = '',
  disabled = false
}: {
  name?: string;
  label: string;
  value: T;
  onChange: (val: T) => void;
  options: SelectOption<T>[];
  className?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const selectedOption = options.find(o => o.value === value) ?? options[0];

  return (
    <div ref={containerRef} className={`custom-select-wrap ${className}`.trim()}>
      <select
        name={name}
        aria-label={label}
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
        presentation="plain"
        type="button"
        className={`custom-select-trigger ${open ? 'active' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen(prev => !prev)}
      >
        <span className="custom-select-text">{selectedOption?.label}</span>
        <ChevronDown size={16} className={`custom-select-chevron ${open ? 'rotated' : ''}`} />
      </Button>

      {open && (
        <ul className="custom-select-dropdown" role="listbox" aria-label={label}>
          {options.map(o => {
            const isSelected = o.value === value;
            return (
              <li
                key={String(o.value)}
                role="option"
                aria-selected={isSelected}
                className={`custom-select-item ${isSelected ? 'selected' : ''}`}
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
              >
                <span>{o.label}</span>
                {isSelected && <Check size={15} className="custom-select-check accent" />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
