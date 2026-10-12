import { Link2 } from 'lucide-react';
import { getSupersetGroup } from '../lib/supersets';
import './Superset.css';

/// A paired exercise's place in its superset ("C1"), drawn in the slot the exercise icon would
/// otherwise take so the header keeps its layout. Unlinking lives in the exercise's actions menu.
export function SupersetPosition({ group, position, partnerNames }: { group: string; position: number; partnerNames: string }) {
  const label = `Superset ${group}, exercise ${position}${partnerNames ? ` with ${partnerNames}` : ''}`;
  return (
    <span className="import-exercise-icon superset-position" role="img" aria-label={label} title={label}>
      <span aria-hidden="true">{group}{position}</span>
    </span>
  );
}

export interface SupersetGroupHeaderProps {
  group?: string;
  sequenceGroup?: string | null;
  count: number;
}

export function SupersetGroupHeader({
  group,
  sequenceGroup,
  count
}: SupersetGroupHeaderProps) {
  const displayGroup = group ?? getSupersetGroup(sequenceGroup);
  const exerciseWord = count === 1 ? 'exercise' : 'exercises';

  return (
    <div className="superset-heading">
      <span className="superset-heading-icon" aria-hidden="true">
        <Link2 size={14} aria-hidden="true" />
      </span>
      <span className="superset-heading-title">Superset {displayGroup}</span>
      <span className="superset-heading-subtitle">
        · {count} {exerciseWord} · alternate sets
      </span>
    </div>
  );
}
