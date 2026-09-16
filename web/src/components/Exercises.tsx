import { useState } from 'react';
import { Dumbbell, Library, Plus, Search, X } from 'lucide-react';
import type { Exercise } from '../types';
import { Button } from './ui/Button';

/// The catalog is supplied by the server and is empty until a seed file is loaded, so the
/// empty state explains that rather than implying the user should have added something.
export function ExerciseLibrary({ exercises, onSelect, exclude = [] }: { exercises: Exercise[]; onSelect?: (id: string) => void; exclude?: string[] }) {
  const [query, setQuery] = useState('');
  const [muscle, setMuscle] = useState('All muscles');
  const muscles = ['All muscles', ...new Set(exercises.map(e => e.muscle).filter(Boolean))];
  const filtered = exercises.filter(e => !exclude.includes(e.id)
    && (muscle === 'All muscles' || e.muscle === muscle)
    && `${e.name} ${e.equipment} ${e.muscle} ${e.aliases.join(' ')}`.toLowerCase().includes(query.toLowerCase()));

  if (!exercises.length) return <div className="empty-message">
    <Library size={32} />
    <h3>The exercise library is empty</h3>
    <p>Exercises are added to the shared library by an administrator, not from the app. Once they are loaded, they will appear here and become selectable in your workouts.</p>
  </div>;

  return <div>
    {!onSelect && <div className="page-heading"><div className="eyebrow">FIND YOUR NEXT MOVEMENT</div><h1>Exercise library<span className="accent">.</span></h1><p>The movements available to your workouts, with cues to make every rep count.</p></div>}
    <div className="search-row">
      <label className="search-box">
        <Search size={18} />
        <input name="exercise-search" aria-label="Search exercises" placeholder="Search exercises or equipment…" value={query} onChange={e => setQuery(e.target.value)} />
        {query && <button type="button" className="search-clear-btn" aria-label="Clear search" onClick={() => setQuery('')}><X size={16} /></button>}
      </label>
      <select name="exercise-muscle" aria-label="Filter by muscle" value={muscle} onChange={e => setMuscle(e.target.value)}>{muscles.map(m => <option key={m}>{m}</option>)}</select>
    </div>
    <div className="filter-chips" role="group" aria-label="Filter exercises by muscle">
      {muscles.map(m => (
        <button
          type="button"
          key={m}
          className={`filter-chip ${muscle === m ? 'active' : ''}`}
          onClick={() => setMuscle(m)}
        >
          {m}
        </button>
      ))}
    </div>
    <div className={onSelect ? 'picker-list' : 'exercise-grid'}>{filtered.map(e =>
      onSelect ? (
        <article className="panel picker-card" key={e.id}>
          <div className="picker-card-info">
            <div className="picker-card-header">
              <h3>{e.name}</h3>
              <div className="picker-tags">
                {e.muscle && <span className="pill pill-accent">{e.muscle}</span>}
                {e.equipment && <span className="pill">{e.equipment}</span>}
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
              {e.muscle && <span className="pill pill-accent">{e.muscle}</span>}
              {e.equipment && <span className="pill">{e.equipment}</span>}
            </div>
          </div>
          <h3>{e.name}</h3>
          {e.cue && <p>{e.cue}</p>}
        </article>
      ))}
    </div>
    {!filtered.length && <p className="empty-message">No matching exercises. Try another name or muscle group.</p>}
  </div>;
}
