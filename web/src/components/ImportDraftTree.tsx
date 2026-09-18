import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Pencil } from 'lucide-react';
import type { DraftWorkout, Exercise, ImportDraft } from '../types';
import { Button } from './ui/Button';
import { ChipScroller } from './ui/ChipScroller';
import { DayEditor, exerciseSummary } from './ImportDayEditor';
import { getWorkoutMuscles } from '../lib/muscles';

type Week = {
  week: number;
  days: DraftWorkout[];
  block: string;
  phases: string[];
  pages: number[];
};

function sourcePages(days: DraftWorkout[]): number[] {
  const pages = days.flatMap(day => [
    day.sourcePage,
    ...day.exercises.flatMap(exercise => [exercise.sourcePage, ...exercise.sets.map(set => set.sourcePage)])
  ]);
  return [...new Set(pages.filter((page): page is number => page != null))].sort((left, right) => left - right);
}

function groupWeeks(draft: ImportDraft): Week[] {
  const grouped = new Map<number, Week>();
  for (const day of draft.workouts) {
    const current = grouped.get(day.week);
    if (current) {
      current.days.push(day);
      if (day.phase && !current.phases.includes(day.phase)) current.phases.push(day.phase);
      continue;
    }
    grouped.set(day.week, {
      week: day.week,
      days: [day],
      block: day.block || 'Program',
      phases: day.phase ? [day.phase] : [],
      pages: []
    });
  }
  return [...grouped.values()]
    .sort((left, right) => left.week - right.week)
    .map(week => ({ ...week, pages: sourcePages(week.days) }));
}

function blockIndex(weeks: Week[], index: number): number {
  let result = 0;
  let previous = '';
  for (let current = 0; current <= index; current++) {
    if (weeks[current].block !== previous) {
      result++;
      previous = weeks[current].block;
    }
  }
  return result;
}

function sourceCaption(pages: number[]): string {
  if (!pages.length) return '';
  const first = pages[0];
  const last = pages.at(-1)!;
  return first === last ? `PDF p.${first}` : `PDF pp. ${first}-${last}`;
}

function weekCaption(week: Week, number: number): string {
  const phase = week.phases.join(' / ') || 'General';
  const source = sourceCaption(week.pages);
  return [`Block ${number}`, phase, source].filter(Boolean).join(' · ');
}

export function DraftOutline({ draft, expandedDay, setExpandedDay, exercises, onDayChange }: {
  draft: ImportDraft;
  expandedDay: string | null;
  setExpandedDay: (id: string | null) => void;
  exercises: Exercise[];
  onDayChange: (day: DraftWorkout) => Promise<void>;
}) {
  const weeks = useMemo(() => groupWeeks(draft), [draft]);
  const [selectedWeek, setSelectedWeek] = useState(weeks[0]?.week ?? 1);

  const blocks = useMemo(() => {
    const list: { name: string; number: number; weeks: Week[] }[] = [];
    for (let i = 0; i < weeks.length; i++) {
      const w = weeks[i];
      const num = blockIndex(weeks, i);
      let b = list.find(item => item.name === w.block);
      if (!b) {
        b = { name: w.block, number: num, weeks: [] };
        list.push(b);
      }
      b.weeks.push(w);
    }
    return list;
  }, [weeks]);

  useEffect(() => {
    setSelectedWeek(current => {
      if (weeks.some(week => week.week === current)) return current;
      const first = weeks[0];
      if (!first) return 1;
      return weeks.reduce((nearest, candidate) =>
        Math.abs(candidate.week - current) < Math.abs(nearest.week - current) ? candidate : nearest,
        first).week;
    });
  }, [weeks]);

  const week = weeks.find(entry => entry.week === selectedWeek) ?? weeks[0];
  if (!week) return null;
  const selectedIndex = weeks.findIndex(entry => entry.week === week.week);
  const selectedBlock = blockIndex(weeks, selectedIndex);

  return <section className="panel import-program-card">
    <div className="section-heading">
      <h2>{draft.programName}</h2>
      <span className="tiny-label">{weeks.length} {weeks.length === 1 ? 'week' : 'weeks'}</span>
    </div>
    {blocks.length > 1 && <div className="import-block-selector" role="tablist" aria-label="Program blocks">
      {blocks.map(b => {
        const isSelected = b.weeks.some(w => w.week === week.week);
        return <Button key={b.name} presentation="plain" role="tab" aria-selected={isSelected}
          className={`filter-chip ${isSelected ? 'active' : ''}`}
          onClick={() => setSelectedWeek(b.weeks[0]?.week ?? week.week)}>
          Block {b.number}{b.name && b.name !== `Block ${b.number}` && b.name !== 'Program' ? ` · ${b.name}` : ''}
        </Button>;
      })}
    </div>}
    <ChipScroller ariaLabel="Program weeks" role="tablist" resetKey={weeks.map(entry => entry.week).join('|')}
      leftLabel="Scroll program weeks left" rightLabel="Scroll program weeks right">
      {weeks.map(entry => <Button key={entry.week} presentation="plain" role="tab" aria-selected={entry.week === week.week}
        className={`filter-chip ${entry.week === week.week ? 'active' : ''}`} onClick={() => setSelectedWeek(entry.week)}>
        Week {entry.week}
      </Button>)}
    </ChipScroller>
    <p className="import-week-caption">{weekCaption(week, selectedBlock)}</p>
    <div className="import-week-days" role="tabpanel" aria-label={`Week ${week.week}`}>
      {week.days.map(day => <DayRow key={day.lineId} day={day} expanded={expandedDay === day.lineId}
        onToggle={() => setExpandedDay(expandedDay === day.lineId ? null : day.lineId)} exercises={exercises} onChange={onDayChange} />)}
    </div>
  </section>;
}

const weekdayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function DayLines({ day }: { day: DraftWorkout }) {
  return <ol className="draft-day-lines">
    {day.exercises.map(exercise => <li key={exercise.lineId}>
      {exercise.sequenceGroup && <span className="draft-line-group">{exercise.sequenceGroup}</span>}
      <span className="draft-line-name">{exercise.sourceName}</span>
      <span className="draft-line-detail">{exerciseSummary(exercise)}</span>
    </li>)}
  </ol>;
}

function DayRow({ day, expanded, onToggle, exercises, onChange }: {
  day: DraftWorkout;
  expanded: boolean;
  onToggle: () => void;
  exercises: Exercise[];
  onChange: (day: DraftWorkout) => Promise<void>;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const muscles = useMemo(() => getWorkoutMuscles(day.exercises, exercises), [day.exercises, exercises]);
  const exercisePreview = useMemo(() => {
    if (day.isRestDay || !day.exercises.length) return '';
    const names = day.exercises.map(e => e.sourceName);
    if (names.length <= 4) return names.join(', ');
    return `${names.slice(0, 4).join(', ')}, and ${names.length - 4} more`;
  }, [day.exercises, day.isRestDay]);

  const fullName = `${day.weekday ? `${weekdayNames[day.weekday - 1]} · ` : ''}${day.name}`;

  return <section className={`draft-day ${day.isRestDay ? 'rest-day' : ''}`}>
    <div className="draft-day-card-header">
      <Button presentation="plain" className="draft-day-summary" aria-expanded={expanded} aria-label={fullName} onClick={onToggle}>
        <div className="draft-day-title-group">
          <strong>{fullName}</strong>
          <div className="draft-day-meta-tags">
            <span className="tiny-label">{day.isRestDay ? 'Rest day' : `${day.exercises.length} exercises`}</span>
            {day.phase?.toLowerCase().includes('deload') && <span className="pill pill-accent">Deload</span>}
            {day.sourcePage && <span className="muted">PDF p.{day.sourcePage}</span>}
          </div>
        </div>
      </Button>
      <div className="draft-day-actions">
        {day.isRestDay ? <span className="tiny-label rest-badge">Rest day</span> : <>
          <Button variant="secondary" className="day-action-button" aria-label={`Edit ${day.name}`} onClick={onToggle}>
            <Pencil size={14} /><span>{expanded ? 'Close' : 'Edit'}</span>
          </Button>
          {!expanded && day.exercises.length > 0 && <Button variant="tertiary" className="day-chevron-button"
            aria-label={showDetails ? `Hide details for ${day.name}` : `View details for ${day.name}`}
            onClick={e => { e.stopPropagation(); setShowDetails(s => !s); }}>
            {showDetails ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </Button>}
        </>}
      </div>
    </div>

    {!expanded && !day.isRestDay && (
      <div className="draft-day-compact-body">
        {exercisePreview && <p className="day-exercise-preview">{exercisePreview}</p>}
        {muscles.length > 0 && <div className="day-muscles-row" aria-label="Targeted muscles">
          {muscles.slice(0, 5).map(m => <span key={m} className="muscle-chip">{m}</span>)}
          {muscles.length > 5 && <span className="muscle-chip muscle-chip-overflow" title={muscles.slice(5).join(', ')}>+{muscles.length - 5}</span>}
        </div>}
      </div>
    )}

    {!expanded && showDetails && !day.isRestDay && day.exercises.length > 0 && <DayLines day={day} />}
    {expanded && <DayEditor day={day} exercises={exercises} onChange={onChange} />}
  </section>;
}
