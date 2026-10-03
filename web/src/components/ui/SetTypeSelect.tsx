import { Select } from './Select';
import type { SetType } from '../../lib/importSetTypes';
import { setTypeOptions } from '../../lib/importSetTypes';
import './SetTypeSelect.css';

const SHORT_LABELS: Record<SetType, string> = {
  normal: 'Set',
  warmup: 'Warm-up',
  dropset: 'Drop set',
  amrap: 'AMRAP',
  myoreps: 'Myo-reps',
  partials: 'Partial',
  lengthenedPartials: 'Lengthened',
  integratedPartials: 'Integrated'
};

// The active workout's narrow column: the count alone for a straight set, a letter for the rest.
const COMPACT_PREFIXES: Record<SetType, string> = {
  normal: '',
  warmup: 'W',
  dropset: 'D',
  amrap: 'F',
  myoreps: 'M',
  partials: 'P',
  lengthenedPartials: 'L',
  integratedPartials: 'I'
};

/// A set's label and its type in one control: the trigger reads "Set 2" or "Warm-up 1", and
/// opening it changes the type. Every type has the same width and shape; only the tint differs,
/// so a warm-up lines up with the working sets beneath it.
export function SetTypeSelect({
  type,
  number,
  ariaLabel,
  name,
  onChange,
  types = setTypeOptions.map(option => option.value as SetType),
  compact = false
}: {
  type: SetType;
  number: number;
  ariaLabel: string;
  name?: string;
  onChange: (type: SetType) => void;
  /** The types this editor offers; the workout builder offers only normal and warm-up sets. */
  types?: SetType[];
  /** A short "W1"/"M3" trigger for a set row; the menu still names each type in full. */
  compact?: boolean;
}) {
  const options = setTypeOptions.filter(option => types.includes(option.value as SetType)) as Array<{ value: SetType; label: string }>;
  return (
    <Select
      name={name}
      ariaLabel={`${ariaLabel}: ${SHORT_LABELS[type]} ${number}`}
      className={`set-type-select set-type-${type} ${compact ? 'set-type-compact' : ''}`.trim()}
      value={type}
      options={options}
      displayLabel={compact ? `${COMPACT_PREFIXES[type]}${number}` : `${SHORT_LABELS[type]} ${number}`}
      // The trigger is a fixed-width label; the menu names each type in full on one line.
      fitMenuToOptions
      onChange={onChange}
    />
  );
}
