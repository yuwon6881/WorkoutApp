import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Dumbbell, Library, Plus, Search, X } from 'lucide-react';
import type { Exercise } from '../types';
import { Button } from './ui/Button';

/// The catalog is supplied by the server and is empty until a seed file is loaded, so the
/// empty state explains that rather than implying the user should have added something.
export function ExerciseLibrary({ exercises, onSelect, exclude = [] }: { exercises: Exercise[]; onSelect?: (id: string) => void; exclude?: string[] }) {
  const [query, setQuery] = useState('');
  const [muscle, setMuscle] = useState('All muscles');
  const chipsRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const muscles = ['All muscles', ...new Set(exercises.map(e => e.muscle).filter(Boolean))];
  const filtered = exercises.filter(e => !exclude.includes(e.id)
    && (muscle === 'All muscles' || e.muscle === muscle)
    && `${e.name} ${e.equipment} ${e.muscle} ${e.movementPattern ?? ''} ${e.aliases.join(' ')}`.toLowerCase().includes(query.toLowerCase()));

  const checkScroll = () => {
    const el = chipsRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 2);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
  };

  useEffect(() => {
    checkScroll();
    const el = chipsRef.current;
    if (!el) return;
    el.addEventListener('scroll', checkScroll, { passive: true });
    window.addEventListener('resize', checkScroll);
    return () => {
      el.removeEventListener('scroll', checkScroll);
      window.removeEventListener('resize', checkScroll);
    };
  }, [muscles]);

  const scrollChips = (direction: 'left' | 'right') => {
    const el = chipsRef.current;
    if (!el) return;
    el.scrollBy({ left: direction === 'left' ? -240 : 240, behavior: 'smooth' });
  };

  if (!exercises.length) return <div className="empty-message">
    <Library size={32} />
    <h3>No exercises available</h3>
    <p>The shared exercise library has not been loaded yet.</p>
  </div>;

  return <div>
    {!onSelect && <div className="page-heading"><h1>Exercises</h1></div>}
    <div className="search-row">
      <label className="search-box">
        <Search size={18} />
        <input name="exercise-search" aria-label="Search exercises" placeholder="Search exercises or equipment…" value={query} onChange={e => setQuery(e.target.value)} />
        {query && <Button presentation="plain" className="search-clear-btn" aria-label="Clear search" onClick={() => setQuery('')}><X size={16} /></Button>}
      </label>
      <select name="exercise-muscle" aria-label="Filter by muscle" value={muscle} onChange={e => setMuscle(e.target.value)}>{muscles.map(m => <option key={m}>{m}</option>)}</select>
    </div>
    <div className="filter-chips-nav">
      <Button
        presentation="plain"
        className="filter-nav-btn"
        aria-label="Scroll muscle filters left"
        disabled={!canScrollLeft}
        onClick={() => scrollChips('left')}
      >
        <ChevronLeft size={18} />
      </Button>
      <div className="filter-chips" ref={chipsRef} role="group" aria-label="Filter exercises by muscle">
        {muscles.map(m => (
          <Button
            presentation="plain"
            key={m}
            className={`filter-chip ${muscle === m ? 'active' : ''}`}
            onClick={() => setMuscle(m)}
          >
            {m}
          </Button>
        ))}
      </div>
      <Button
        presentation="plain"
        className="filter-nav-btn"
        aria-label="Scroll muscle filters right"
        disabled={!canScrollRight}
        onClick={() => scrollChips('right')}
      >
        <ChevronRight size={18} />
      </Button>
    </div>
    <div className={onSelect ? 'picker-list' : 'exercise-grid'}>{filtered.map(e =>
      onSelect ? (
        <article className="panel picker-card" key={e.id}>
          <div className="picker-card-info">
            <div className="picker-card-header">
              <h3>{e.name}</h3>
              <div className="picker-tags">
                <span className="pill pill-accent">{e.muscle || 'Full body'}</span>
                <span className="pill">{e.equipment || 'General'}</span>
              </div>
            </div>
            {e.cue && <p className="picker-cue">{e.cue}</p>}
          </div>
          <Button
            className="picker-add-btn"
            variant="secondary"
            aria-label={`Add ${e.name}`}
            onClick={() => onSelect(e.id)}
          >
            <Plus size={16} />
            <span className="picker-add-label">Add <span className="picker-btn-name">{e.name}</span></span>
          </Button>
        </article>
      ) : (
        <article className="panel exercise-card" key={e.id}>
          <div className="exercise-card-top">
            <span className="exercise-icon"><Dumbbell size={22} /></span>
            <div className="picker-tags">
              <span className="pill pill-accent">{e.muscle || 'Full body'}</span>
              <span className="pill">{e.equipment || 'General'}</span>
            </div>
          </div>
          <div className="exercise-card-body">
            <h3>{e.name}</h3>
            {e.cue && <p>{e.cue}</p>}
          </div>
        </article>
      ))}
    </div>
    {!filtered.length && <p className="empty-message">No matching exercises.</p>}
  </div>;
}
