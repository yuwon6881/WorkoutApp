import { RotateCcw } from 'lucide-react';
import type { CSSProperties } from 'react';
import { Button } from './ui/Button';
import type { RemovedPlaceholder } from './useRemovedSets';

/** Stands in the removed row's exact place and height, offering Undo until it collapses. */
export function WorkoutRemovedSet({ placeholder, onUndo }: { placeholder: RemovedPlaceholder; onUndo: (key: string) => void }) {
  const name = `Set ${placeholder.label}`;
  return (
    <div className={`workout-set-removed ${placeholder.leaving ? 'leaving' : ''}`.trim()}
      style={{ '--removed-height': `${placeholder.height}px` } as CSSProperties}>
      <span role="status">{name} removed.</span>
      {!placeholder.leaving && <Button variant="tertiary" aria-label={`Undo removing ${name.toLowerCase()}`} onClick={() => onUndo(placeholder.key)}>
        <RotateCcw size={15} aria-hidden="true" />Undo
      </Button>}
    </div>
  );
}
