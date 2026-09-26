import { Select } from './Select';
import type { SetType } from '../../lib/importSetTypes';
import { setTypeOptions } from '../../lib/importSetTypes';
import './SetTypeSelect.css';

const SHORT_LABELS: Record<SetType, string> = {
  normal: 'Set',
  warmup: 'Warm-up',
  dropset: 'Drop set',
  amrap: 'AMRAP',
  myoreps: 'Myo-reps'
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
  types = setTypeOptions.map(option => option.value as SetType)
}: {
  type: SetType;
  number: number;
  ariaLabel: string;
  name?: string;
  onChange: (type: SetType) => void;
  /** The types this editor offers; the workout builder offers only normal and warm-up sets. */
  types?: SetType[];
}) {
  const options = setTypeOptions.filter(option => types.includes(option.value as SetType)) as Array<{ value: SetType; label: string }>;
  return (
    <Select
      name={name}
      ariaLabel={`${ariaLabel}: ${SHORT_LABELS[type]} ${number}`}
      className={`set-type-select set-type-${type}`}
      value={type}
      options={options}
      displayLabel={`${SHORT_LABELS[type]} ${number}`}
      onChange={onChange}
    />
  );
}
