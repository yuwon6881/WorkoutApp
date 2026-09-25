import './Switch.css';

/// An on/off preference. It is a button with the switch role rather than a checkbox so it keeps the
/// shared focus ring and a 44 px target on compact and medium layouts.
export function Switch({ checked, onChange, label, describedBy, disabled = false }: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  describedBy?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      className="switch"
      aria-checked={checked}
      aria-label={label}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="switch-track" aria-hidden="true"><span className="switch-thumb" /></span>
    </button>
  );
}
