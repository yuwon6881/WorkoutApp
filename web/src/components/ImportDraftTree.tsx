import { useEffect, useMemo, useState } from 'react';
import type { DraftWorkout, Exercise, ImportDraft } from '../types';
import { Button } from './ui/Button';
import { ChipScroller } from './ui/ChipScroller';
import { DayEditor, exerciseSummary } from './ImportDayEditor';

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
    <ChipScroller ariaLabel="Program weeks" role="tablist" resetKey={weeks.map(entry => entry.week).join('|')}
      leftLabel="Scroll program weeks left" rightLabel="Scroll program weeks right">
      {weeks.map((entry, index) => <span className="import-week-chip-group" key={entry.week}>
        {(index === 0 || entry.block !== weeks[index - 1].block) && <span className="import-block-label">Block {blockIndex(weeks, index)}</span>}
        <Button presentation="plain" role="tab" aria-selected={entry.week === week.week}
          className={`filter-chip ${entry.week === week.week ? 'active' : ''}`} onClick={() => setSelectedWeek(entry.week)}>
          Week {entry.week}
        </Button>
      </span>)}
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
  return <section className={`draft-day ${day.isRestDay ? 'rest-day' : ''}`}>
    <Button presentation="plain" className="draft-day-summary" aria-expanded={expanded} onClick={onToggle}>
      <span>
        <strong>{day.weekday ? `${weekdayNames[day.weekday - 1]} · ` : ''}{day.name}</strong>
        <small>{day.isRestDay ? 'Rest day' : `${day.exercises.length} exercises`}{day.phase?.toLowerCase().includes('deload') ? ' · Deload' : ''}{day.sourcePage ? ` · PDF p.${day.sourcePage}` : ''}</small>
      </span>
      <span className="tiny-label">{day.isRestDay ? 'Rest day' : expanded ? 'Close' : 'Edit'}</span>
    </Button>
    {!expanded && !day.isRestDay && day.exercises.length > 0 && <DayLines day={day} />}
    {expanded && <DayEditor day={day} exercises={exercises} onChange={onChange} />}
  </section>;
}
