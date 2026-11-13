import { ArrowRight } from 'lucide-react';
import type { Session } from '../types';

/// The exercise after this one, under the notes, so the end of a page says what comes next rather
/// than ending in empty space. It is passive: the strip above and a sideways swipe turn the page.
/// A superset partner is already named by the Superset pill, and the last exercise shows nothing.
export function WorkoutUpNext({ draft, index }: { draft: Session; index: number }) {
  const next = draft.exercises[index + 1];
  if (!next) return null;
  const working = next.sets.filter(set => !set.warmup);
  const logged = working.filter(set => set.done).length;
  const detail = working.length === 0 ? null
    : logged > 0 ? `${logged} of ${working.length} sets logged`
    : `${working.length} ${working.length === 1 ? 'set' : 'sets'}`;
  return (
    <p className="workout-up-next">
      <span className="workout-up-next-label">Up next</span>
      <span className="workout-up-next-name">{next.name}</span>
      {detail && <span className="workout-up-next-detail">{detail}</span>}
      <ArrowRight size={16} aria-hidden="true" />
    </p>
  );
}
