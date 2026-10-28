import { RotateCcw } from 'lucide-react';
import type { CSSProperties } from 'react';
import { Button } from './ui/Button';
import { SwipeDismiss } from './ui/SwipeDismiss';
import type { RemovedPlaceholder } from './useRemovedSets';

/** Stands in the removed row's exact place and height, offering Undo until it collapses. */
export function WorkoutRemovedSet({
  placeholder,
  onUndo,
  onDismiss = () => {}
}: {
  placeholder: RemovedPlaceholder;
  onUndo: (key: string) => void;
  onDismiss?: (key: string) => void;
}) {
  const name = `Set ${placeholder.label}`;
  const content = (
    <div
      className={`workout-set-removed ${placeholder.leaving ? 'leaving' : ''}`.trim()}
      style={{ '--removed-height': `${placeholder.height}px` } as CSSProperties}
    >
      <span role="status">{name} removed.</span>
      {!placeholder.leaving && (
        <Button
          variant="tertiary"
          aria-label={`Undo removing ${name.toLowerCase()}`}
          onClick={() => onUndo(placeholder.key)}
        >
          <RotateCcw size={15} aria-hidden="true" />Undo
        </Button>
      )}
    </div>
  );

  // The wrapper stays mounted while the row collapses so the height transition is not cut off.
  return (
    <SwipeDismiss onDismiss={() => { if (!placeholder.leaving) onDismiss(placeholder.key); }}>
      {content}
    </SwipeDismiss>
  );
}
