import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { formatSets, shadeFor } from '../lib/muscleBalance';
import type { PlannedMuscleSummary } from '../lib/programMuscles';
import { MuscleThumb } from './MuscleThumb';
import { Button } from './ui/Button';
import { useReducedMotion } from './ui/Motion';

const THUMB_ASPECT = 104 / 96;

/// Which ends of the strip still hide tiles, so the arrows and edge fades only offer real scrolling.
function useScrollEdges(element: HTMLElement | null, itemCount: number) {
  const [edges, setEdges] = useState({ start: false, end: false });
  useEffect(() => {
    if (!element) return;
    const measure = () => setEdges({
      start: element.scrollLeft > 4,
      end: element.scrollLeft + element.clientWidth < element.scrollWidth - 4
    });
    measure();
    element.addEventListener('scroll', measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => { element.removeEventListener('scroll', measure); observer.disconnect(); };
  }, [element, itemCount]);
  return edges;
}

/**
 * The muscles one session trained, busiest first, as a row of body-map crops that scrolls sideways.
 * Credits follow the Muscles map: a logged working set counts in full for its primary muscle and
 * half for each secondary.
 */
export function SessionMuscleStrip({ summary, loading }: { summary: PlannedMuscleSummary | null; loading: boolean }) {
  const [rail, setRail] = useState<HTMLUListElement | null>(null);
  const railRef = useRef<HTMLUListElement | null>(null);
  const muscles = summary?.muscles ?? [];
  const edges = useScrollEdges(rail, muscles.length);
  const peak = muscles[0]?.sets ?? 0;
  const reduced = useReducedMotion();

  const page = (direction: -1 | 1) => {
    const element = railRef.current;
    if (!element) return;
    element.scrollBy({ left: direction * element.clientWidth * 0.8, behavior: reduced ? 'auto' : 'smooth' });
  };

  return (
    <section className="session-section session-muscles" aria-labelledby="session-muscles-heading">
      <div className="session-section-heading">
        <h3 id="session-muscles-heading">Muscles worked</h3>
        {(edges.start || edges.end) && <div className="session-muscles-arrows">
          <Button variant="tertiary" className="session-muscles-arrow" aria-label="Previous muscles"
            disabled={!edges.start} onClick={() => page(-1)}><ChevronLeft size={16} /></Button>
          <Button variant="tertiary" className="session-muscles-arrow" aria-label="More muscles"
            disabled={!edges.end} onClick={() => page(1)}><ChevronRight size={16} /></Button>
        </div>}
      </div>

      {loading ? (
        <div className="session-muscle-rail is-loading" aria-busy="true" aria-label="Loading muscles worked">
          {[0, 1, 2, 3].map(index => <div className="session-muscle-tile skeleton" key={index} aria-hidden="true" />)}
        </div>
      ) : muscles.length > 0 ? (
        <div className={`session-muscle-scroller${edges.start ? ' fade-start' : ''}${edges.end ? ' fade-end' : ''}`}>
          <ul className="session-muscle-rail" role="list" tabIndex={0} aria-label="Muscles worked, busiest first"
            ref={element => { railRef.current = element; setRail(element); }}>
            {muscles.map(({ muscle, sets }) => (
              <li className="session-muscle-tile" key={muscle}>
                <MuscleThumb muscle={muscle} shade={shadeFor(sets, peak)} aspect={THUMB_ASPECT} className="session-muscle-figure" />
                <strong>{muscle}</strong>
                <span>{formatSets(sets)} {sets === 1 ? 'set' : 'sets'}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="session-section-empty">No logged set could be matched to a muscle.</p>
      )}

      {!loading && summary && summary.unattributedExercises > 0 && muscles.length > 0 && (
        <p className="session-section-note">
          Muscle data is unavailable for {summary.unattributedExercises} {summary.unattributedExercises === 1 ? 'exercise' : 'exercises'}.
        </p>
      )}
    </section>
  );
}
