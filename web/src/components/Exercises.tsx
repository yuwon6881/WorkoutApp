import { loadAdjustable } from '../lib/exerciseLoads';
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, Check, Link2, Plus, Search, X } from 'lucide-react';
import type { Exercise, ExerciseCategory, Unit } from '../types';
import { lastPerformedLabel } from '../lib/lastPerformed';
import { useLastPerformed } from './useLastPerformed';
import { Button } from './ui/Button';
import { Select } from './ui/Select';
import { CustomExerciseModal } from './CustomExerciseModal';
import { getExerciseCategory, informativeEquipment } from '../lib/exerciseCategory';
import { buildExerciseSearchIndex, searchExerciseScores } from '../lib/exerciseSearch';
import { ChipScroller } from './ui/ChipScroller';
import { GymAvailabilityBadge } from './GymAvailabilityBadge';
import { useGymAvailabilityCheck } from '../lib/gymAvailability';
import './Exercises.css';
import './RenderWindow.css';

/// The catalog is supplied by the server and is empty until a seed file is loaded, so the
/// empty state explains that rather than implying the user should have added something.
const emptyIds: string[] = [];
const RECENT_LIMIT = 6;

export type ExercisePickerAction = 'add' | 'swap' | 'map';

function normalized(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ');
}

/// Ranks every candidate against the current exercise once; the current exercise's muscles and the
/// preferred names are normalized a single time rather than inside each sort comparison.
function exerciseRanks(candidates: Exercise[], current: Exercise | undefined, preferredNames: string[]) {
  const preferred = new Set(preferredNames.map(normalized));
  const primary = current ? normalized(current.muscle) : '';
  const secondary = new Set((current?.secondaryMuscles ?? []).map(normalized));
  return new Map(candidates.map(candidate => [candidate.id, exerciseRank(candidate, current, preferred, primary, secondary)]));
}

function exerciseRank(candidate: Exercise, current: Exercise | undefined, preferred: Set<string>, primary: string, secondary: Set<string>) {
  if ([candidate.name, ...candidate.aliases].some(name => preferred.has(normalized(name)))) return 0;
  if (!current) return 1;

  const candidatePrimary = normalized(candidate.muscle);
  const candidateSecondary = (candidate.secondaryMuscles ?? []).map(normalized);
  const sharedSecondary = candidateSecondary.filter(value => secondary.has(value)).length;
  if (candidatePrimary === primary && sharedSecondary > 0) return 1;
  if (candidatePrimary === primary) return 2;
  if (secondary.has(candidatePrimary) || candidateSecondary.includes(primary)) return 3;
  return 4;
}

export function ExerciseLibrary({ exercises, onSelect, exclude = emptyIds, added = emptyIds, onOpen, onChanged, action = 'add', currentExerciseId, preferredNames = emptyIds, disabled = false, unit }: {
  exercises: Exercise[];
  /** Picked during this visit to the picker: kept in place and marked Added rather than removed. */
  added?: string[];
  /** When given (the library tab), cards add the exercise's last top set in this unit. */
  unit?: Unit;
  onSelect?: (id: string) => void;
  exclude?: string[];
  onOpen?: (exercise: Exercise) => void;
  onChanged?: () => Promise<void> | void;
  action?: ExercisePickerAction;
  currentExerciseId?: string | null;
  preferredNames?: string[];
  disabled?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [muscle, setMuscle] = useState('All muscles');
  // The library tab labels its cards with each last top set; the add picker leads with what was
  // trained most recently. Both read the same account-scoped cached list.
  const lastPerformed = useLastPerformed((Boolean(unit) && !onSelect) || (Boolean(onSelect) && action === 'add'));
  const lastLabel = (exercise: Exercise) => {
    const last = lastPerformed.get(exercise.id);
    return unit && last ? lastPerformedLabel(last, unit, exercise) : null;
  };
  const [source, setSource] = useState<'all' | 'custom' | 'catalog'>('all');
  const [category, setCategory] = useState<'all' | ExerciseCategory>('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [showAllMuscles, setShowAllMuscles] = useState(false);

  useEffect(() => {
    setShowAllMuscles(false);
  }, [muscle, category, source, currentExerciseId]);

  // Filtering the whole catalog on every keystroke can stall typing on a phone; the list follows
  // the query a moment later while the field itself stays instant.
  const search = useDeferredValue(query);
  const searchIndex = useMemo(() => new Map(exercises.map(e => [e.id, buildExerciseSearchIndex(e)])), [exercises]);
  const searchScores = useMemo(() => searchExerciseScores(searchIndex, search), [searchIndex, search]);
  const muscles = useMemo(() => ['All muscles', ...new Map(exercises.flatMap(e => [e.muscle, ...(e.secondaryMuscles ?? [])])
    .filter(Boolean).map(value => [value.toLowerCase(), value] as const)).values()], [exercises]);
  const current = currentExerciseId ? exercises.find(e => e.id === currentExerciseId) : undefined;
  const isSwapping = action === 'swap' && !!current;

  // Candidate replacement exercises exclude existing exclusions and the current exercise being swapped
  const excluded = new Set([...exclude, ...(currentExerciseId ? [currentExerciseId] : [])]);
  const filtered = useMemo(() => exercises.filter(e => !excluded.has(e.id)
    && (source === 'all' || (source === 'custom' ? e.isCustom : !e.isCustom))
    && (category === 'all' || getExerciseCategory(e) === category)
    && (muscle === 'All muscles' || [e.muscle, ...(e.secondaryMuscles ?? [])].some(value => value.toLowerCase() === muscle.toLowerCase()))
    && searchScores.has(e.id)), [exercises, exclude, currentExerciseId, source, category, muscle, searchScores]);
  const ranks = useMemo(() => exerciseRanks(filtered, current, preferredNames), [filtered, current, preferredNames]);
  const checkGym = useGymAvailabilityCheck();
  // A swap or an addition is for this gym, so what it can host comes first; mapping a written
  // movement to the library is about identity and keeps the plain order.
  const gymRanks = useMemo(() => new Map(filtered.map(exercise =>
    [exercise.id, action !== 'map' && !checkGym(exercise.id).available ? 1 : 0])), [filtered, checkGym, action]);
  // While searching, the closest name match leads within its group; with no query the order is
  // the plain relevance rank and then the name.
  const ordered = useMemo(() => [...filtered].sort((a, b) => (gymRanks.get(a.id) ?? 0) - (gymRanks.get(b.id) ?? 0) || (ranks.get(a.id) ?? 4) - (ranks.get(b.id) ?? 4)
    || (searchScores.get(a.id) ?? 0) - (searchScores.get(b.id) ?? 0)
    || a.name.localeCompare(b.name)), [filtered, ranks, searchScores, gymRanks]);
  const actionLabel = action === 'swap' ? 'Swap' : action === 'map' ? 'Map' : 'Add';
  const ActionIcon = action === 'add' ? Plus : action === 'swap' ? ArrowLeftRight : Link2;

  const currentCategory = current ? getExerciseCategory(current) : null;
  const baseCategories: ExerciseCategory[] = ['Free Weights', 'Machine', 'Body Weight'];
  const categoryOrder: ExerciseCategory[] = currentCategory
    ? [currentCategory, ...baseCategories.filter(c => c !== currentCategory)]
    : ['Free Weights', 'Machine', 'Body Weight'];

  const isRelevant = (e: Exercise) => (ranks.get(e.id) ?? 4) < 4;
  const showBoundary = isSwapping && !query.trim() && muscle === 'All muscles';
  // What the source document itself suggests for this movement gets its own section, apart from
  // the library's similarity ranking. It shows only while nothing narrows the list.
  const showRecommended = isSwapping && preferredNames.length > 0 && !query.trim() && muscle === 'All muscles'
    && source === 'all' && category === 'all';
  const recommended = showRecommended ? ordered.filter(e => ranks.get(e.id) === 0) : [];
  const recommendedIds = new Set(recommended.map(e => e.id));
  const unmatchedSuggestions = showRecommended ? preferredNames.filter(name => !exercises.some(e =>
    [e.name, ...e.aliases].some(alias => normalized(alias) === normalized(name)))) : [];
  // Adding to a workout starts from the movements trained most recently, while nothing narrows the list.
  const showRecent = Boolean(onSelect) && action === 'add' && !query.trim() && muscle === 'All muscles'
    && source === 'all' && category === 'all';
  const recent = showRecent ? ordered.filter(e => lastPerformed.has(e.id))
    .sort((a, b) => (lastPerformed.get(b.id)?.finishedAt ?? '').localeCompare(lastPerformed.get(a.id)?.finishedAt ?? ''))
    .slice(0, RECENT_LIMIT) : [];
  const recentIds = new Set(recent.map(e => e.id));
  const relevantList = (showBoundary ? ordered.filter(isRelevant) : ordered).filter(e => !recommendedIds.has(e.id) && !recentIds.has(e.id));
  const otherList = showBoundary ? ordered.filter(e => !isRelevant(e) && !recommendedIds.has(e.id)) : [];

  const currentMatches = current && searchScores.has(current.id)
    && (source === 'all' || (source === 'custom' ? current.isCustom : !current.isCustom))
    && (category === 'all' || getExerciseCategory(current) === category)
    && (muscle === 'All muscles' || [current.muscle, ...(current.secondaryMuscles ?? [])].some(val => val.toLowerCase() === muscle.toLowerCase()));
  const showCurrentAtTop = isSwapping && current && currentMatches && (muscle === 'All muscles' || [current.muscle, ...(current.secondaryMuscles ?? [])].some(val => val.toLowerCase() === muscle.toLowerCase()));

  function renderCategoryGroups(items: Exercise[], heading?: string) {
    const groups: [string, Exercise[]][] = heading
      ? [[heading, items]]
      : categoryOrder.map(cat => [cat, items.filter(e => getExerciseCategory(e) === cat)]);
    return groups.map(([cat, catItems]) => {
      if (!catItems.length) return null;
      return (
        <section className="category-group" key={cat} aria-label={`${cat} exercises`}>
          <div className="category-group-header">
            <h4 className="category-group-title">{cat}</h4>
            <span className="tiny-label category-group-count">{catItems.length}</span>
          </div>
          <div className={`${onSelect ? 'picker-list' : 'exercise-grid'}${items.length > 100 ? ' render-windowed' : ''}`}>
            {catItems.map(e => (
              onSelect ? (
                <article className="panel picker-card" key={e.id}>
                  <div className="picker-card-info">
                    <div className="picker-card-header">
                      <h3 title={e.name}>{e.name}</h3>
                    </div>
                    <div className="picker-tags">
                      {loadAdjustable(e) && e.weightBasis === 'per_side' && <span className="pill pill-muted">Per side</span>}
                      {e.isCustom && <span className="pill pill-muted">Custom</span>}
                      <span className="pill pill-accent picker-muscle-tag">{e.muscle || 'Full body'}</span>
                      {e.secondaryMuscles && e.secondaryMuscles.length > 0 && (
                        <span className="pill pill-muted">{e.secondaryMuscles[0]}</span>
                      )}
                      {e.secondaryMuscles && e.secondaryMuscles.length > 1 && (
                        <span className="pill pill-muted pill-overflow" title={e.secondaryMuscles.slice(1).join(', ')}>
                          +{e.secondaryMuscles.length - 1}
                        </span>
                      )}
                      {informativeEquipment(e) && <span className="pill pill-equipment">{informativeEquipment(e)}</span>}
                      <GymAvailabilityBadge exerciseId={e.id} compact />
                    </div>
                  </div>
                  {added.includes(e.id) ? (
                    <Button className="picker-add-btn picker-added" variant="tertiary" aria-label={`${e.name} added`} disabled>
                      <Check size={16} />
                      <span className="picker-add-label">Added</span>
                    </Button>
                  ) : (
                    <Button
                      className="picker-add-btn"
                      variant="secondary"
                      aria-label={`${actionLabel} ${e.name}`}
                      disabled={disabled}
                      onClick={() => onSelect(e.id)}
                    >
                      <ActionIcon size={16} />
                      <span className="picker-add-label">{actionLabel}</span>
                    </Button>
                  )}
                </article>
              ) : (
                <article className="panel exercise-card exercise-card-action" key={e.id} tabIndex={0} role="button" aria-label={`View ${e.name} details`}
                  onClick={() => onOpen?.(e)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen?.(e); } }}>
                  <div className="exercise-card-top">
                    <h3 className="exercise-card-title" title={e.name}>{e.name}</h3>
                    {informativeEquipment(e) && <div className="exercise-card-badges">
                      <span className="pill pill-equipment">{informativeEquipment(e)}</span>
                    </div>}
                  </div>
                  <div className="exercise-card-meta">
                    {loadAdjustable(e) && e.weightBasis === 'per_side' && <span className="pill pill-muted">Per side</span>}
                    {e.isCustom && <span className="pill pill-muted">Custom</span>}
                    <span className="pill pill-accent">{e.muscle || 'Full body'}</span>
                    {e.secondaryMuscles && e.secondaryMuscles.length > 0 && (
                      <span className="pill pill-muted">{e.secondaryMuscles[0]}</span>
                    )}
                    {e.secondaryMuscles && e.secondaryMuscles.length > 1 && (
                      <span className="pill pill-muted pill-overflow" title={e.secondaryMuscles.slice(1).join(', ')}>
                        +{e.secondaryMuscles.length - 1}
                      </span>
                    )}
                    <GymAvailabilityBadge exerciseId={e.id} compact passive />
                  </div>
                  {lastLabel(e) && <p className="exercise-card-last">{lastLabel(e)}</p>}
                </article>
              )
            ))}
          </div>
        </section>
      );
    });
  }

  if (!exercises.length) return <>
    {!onSelect && <div className="page-heading"><h1 data-page-heading tabIndex={-1}>Exercises</h1><Button variant="primary" onClick={() => setCreateOpen(true)}><Plus size={16} />Create exercise</Button></div>}
    <div className="empty-message">
      <h3>No exercises available</h3>
      <p>Exercise library has not loaded.</p>
    </div>
    {createOpen && <CustomExerciseModal onClose={() => setCreateOpen(false)} onCreated={async () => { setCreateOpen(false); await onChanged?.(); }} />}
  </>;

  return <div>
    {!onSelect && <div className="page-heading"><h1 data-page-heading tabIndex={-1}>Exercises</h1><Button variant="primary" onClick={() => setCreateOpen(true)}><Plus size={16} />Create exercise</Button></div>}
    <div className="search-row">
      <label className="search-box">
        <Search size={18} />
        <input name="exercise-search" aria-label="Search exercises" placeholder="Search exercises or equipment…" value={query} onChange={e => setQuery(e.target.value)}
          inputMode="search" enterKeyHint="search" autoComplete="off" autoCorrect="off" spellCheck={false}
          // Results update as you type, so Search only needs to put the keyboard away.
          onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
        {query && <Button presentation="plain" className="search-clear-btn" aria-label="Clear search" onClick={() => setQuery('')}><X size={16} /></Button>}
      </label>
      <div className="exercise-minor-filters" role="group" aria-label="Filter exercises">
        <Select
          name="exercise-source-filter"
          ariaLabel="Filter exercise source"
          value={source}
          onChange={val => setSource(val as 'all' | 'custom' | 'catalog')}
          className="exercise-filter-select"
          options={[
            { value: 'all', label: 'All types' },
            { value: 'catalog', label: 'Standard' },
            { value: 'custom', label: 'Custom' }
          ]}
        />
        <Select
          name="exercise-category-filter"
          ariaLabel="Filter exercise category"
          value={category}
          onChange={val => setCategory(val as 'all' | ExerciseCategory)}
          className="exercise-filter-select"
          options={[
            { value: 'all', label: 'All equipment' },
            { value: 'Free Weights', label: 'Free Weights' },
            { value: 'Machine', label: 'Machine' },
            { value: 'Body Weight', label: 'Body Weight' }
          ]}
        />
      </div>
    </div>
    <ChipScroller ariaLabel="Filter exercises by muscle" resetKey={muscles.join('|')}
      leftLabel="Scroll muscle filters left" rightLabel="Scroll muscle filters right">
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
    </ChipScroller>

    {showCurrentAtTop && (
      <div className="picker-current-section">
        <span className="tiny-label">Current exercise</span>
        <article className="panel picker-card picker-card-current" key={`current-${current.id}`}>
          <div className="picker-card-info">
            <div className="picker-card-header">
              <h3 title={current.name}>{current.name}</h3>
            </div>
            <div className="picker-tags">
              {current.isCustom && <span className="pill pill-muted">Custom</span>}
              <span className="pill pill-accent picker-muscle-tag">{current.muscle || 'Full body'}</span>
              {(current.secondaryMuscles ?? []).map(secondary => <span className="pill pill-muted" key={`cur-${current.id}-${secondary}`}>{secondary}</span>)}
              {informativeEquipment(current) && <span className="pill pill-equipment">{informativeEquipment(current)}</span>}
              <GymAvailabilityBadge exerciseId={current.id} compact />
              <span className="pill pill-category">{getExerciseCategory(current)}</span>
            </div>
          </div>
          <Button
            className="picker-add-btn picker-current-btn"
            variant="secondary"
            aria-label={`Current exercise: ${current.name}`}
            disabled
          >
            <span className="picker-add-label">Current</span>
          </Button>
        </article>
      </div>
    )}

    {recent.length > 0 && renderCategoryGroups(recent, 'Recently trained')}

    {recommended.length > 0 && (
      <div className="picker-recommended">
        {renderCategoryGroups(recommended, 'Recommended in your program')}
        {unmatchedSuggestions.length > 0 && (
          <p className="muted picker-recommended-note">
            Also suggested, not in the library: {unmatchedSuggestions.join(', ')}.
          </p>
        )}
      </div>
    )}

    {renderCategoryGroups(relevantList)}

    {showBoundary && otherList.length > 0 && !showAllMuscles && (
      <div className="picker-relevancy-boundary" role="region" aria-label="End of similar exercises">
        <div className="picker-divider-line" />
        <div className="picker-boundary-content">
          <p className="picker-boundary-text">Showing exercises similar to {current.name}.</p>
          <Button
            variant="secondary"
            className="picker-show-all-btn"
            onClick={() => setShowAllMuscles(true)}
          >
            Show all exercises
          </Button>
        </div>
      </div>
    )}

    {showBoundary && otherList.length > 0 && showAllMuscles && (
      <>
        <div className="picker-relevancy-boundary" role="region" aria-label="Other muscle exercises">
          <div className="picker-divider-line" />
          <div className="picker-boundary-content">
            <span className="tiny-label picker-boundary-label">Other muscle exercises</span>
          </div>
        </div>
        {renderCategoryGroups(otherList)}
      </>
    )}

    {!filtered.length && !showCurrentAtTop && <p className="empty-message">No matching exercises.</p>}
    {createOpen && <CustomExerciseModal onClose={() => setCreateOpen(false)} onCreated={async () => { setCreateOpen(false); await onChanged?.(); }} />}
  </div>;
}

// The detail dialog ships in this lazy chunk with the library that opens it.
export { ExerciseDetailModal } from './ExerciseDetailModal';
