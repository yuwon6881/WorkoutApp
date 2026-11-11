import type { ProgramSummary } from '../types';
import { programWeekCompletion, weekCompletionCaption } from '../lib/programWeekCompletion';
import './ProgramWeekCompletion.css';

/// Factual completion ring and progress caption for the current program week. Completed workouts
/// fill the ring in accent; skipped ones follow in a muted arc, so a week that moved on without a
/// workout shows where it stands without the skip being counted as done.
export function ProgramWeekCompletion({ program, standalone = false }: { program: ProgramSummary | null; standalone?: boolean }) {
  const completion = programWeekCompletion(program);
  const title = completion ? `Week ${completion.week}` : 'Training week';
  const progress = completion ? weekCompletionCaption(completion) : 'No active program';
  const skippedLabel = completion?.skipped ? ` and ${completion.skipped} skipped` : '';

  const ring = (
    <svg
      className="weekly-completion-ring"
      viewBox="0 0 100 100"
      role="img"
      aria-label={completion ? `${completion.completed} of ${completion.total} workouts completed${skippedLabel} in program week ${completion.week}` : 'Weekly completion: no active program'}
    >
      <circle className="completion-track" cx="50" cy="50" r="42" />
      {/* Drawn first and from the top through both shares, so the completed arc covers its start. */}
      {completion && completion.skippedRatio > 0 && (
        <circle
          className="completion-skipped"
          cx="50"
          cy="50"
          r="42"
          pathLength="100"
          strokeDasharray={`${(completion.ratio + completion.skippedRatio) * 100} 100`}
          transform="rotate(-90 50 50)"
        />
      )}
      {completion && completion.ratio > 0 && (
        <circle
          className="completion-fill"
          cx="50"
          cy="50"
          r="42"
          pathLength="100"
          strokeDasharray={`${completion.ratio * 100} 100`}
          transform="rotate(-90 50 50)"
        />
      )}
      <text x="50" y="50" dy="0.36em" textAnchor="middle">
        {completion?.total ? completion.completed : '—'}
        {/* The calendar's ring is too small to read the total; its caption beside it states it. */}
        {standalone && completion && completion.total > 0 && <tspan className="completion-total">/{completion.total}</tspan>}
      </text>
    </svg>
  );

  if (standalone) {
    return (
      <section className="panel program-week-card" aria-label="Program week">
        <h3 className="program-week-card-title">{title}</h3>
        {ring}
        <p className="program-week-card-progress">{progress}</p>
        {program && <p className="program-week-card-name">{program.name}</p>}
      </section>
    );
  }

  return (
    <div className="calendar-completion">
      {/* With no program there is nothing to count, so no empty ring: the caption says why. */}
      {completion && ring}
      <div className="calendar-title-wrap">
        <h3>{title}</h3>
        {/* The program is named on the next-workout card; repeating it here wrapped the caption
            into a narrow column beside the week range. */}
        <span className="calendar-ring-caption">{progress}</span>
      </div>
    </div>
  );
}
