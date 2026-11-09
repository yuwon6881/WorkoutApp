import { useMemo } from 'react';
import { Clock3 } from 'lucide-react';
import type { Bootstrap, Template } from '../types';
import { api } from '../lib/api';
import { nextWorkoutPlan } from '../lib/nextWorkoutPlan';
import { Skeleton } from './ui/Skeleton';
import { useCachedViewRead } from './useCachedViewRead';
import { useLastPerformedRead } from './useLastPerformed';
import './NextWorkoutPlan.css';

/// The next workout's length and opening exercises, so the hero answers "what am I doing today?"
/// without opening the preview. Both optional reads reuse the account-scoped memory cache so
/// switching tabs does not fetch them again.
export function NextWorkoutPlan({ data, templateId }: { data: Bootstrap; templateId: string }) {
  const loaded = data.templates?.find(template => template.id === templateId && template.exercises.length > 0);
  const templateRead = useCachedViewRead<Template>(
    `template:${templateId}`,
    1,
    signal => api.getTemplate(templateId, signal),
    !loaded
  );
  const last = useLastPerformedRead(true);
  const template = loaded ?? templateRead.value;
  const templateUnavailable = !template && !templateRead.loading;
  const waiting = !templateUnavailable && ((!template && templateRead.loading) || !last.settled);

  const plan = useMemo(() => template && last.settled
    ? nextWorkoutPlan(template, last.map, data.exercises, data.preferences.unit, data.preferences.restSeconds ?? 90)
    : null, [template, last.settled, last.map, data.exercises, data.preferences.unit, data.preferences.restSeconds]);

  // Rows are reserved while the plan is read, so the hero does not grow under the reader.
  if (waiting) return (
    <div className="hero-plan" aria-hidden="true">
      <Skeleton className="hero-plan-skeleton-line" />
      {[0, 1, 2].map(row => <Skeleton key={row} className="hero-plan-skeleton-row" />)}
    </div>
  );
  if (!plan || plan.rows.length === 0) return null;
  return (
    <div className="hero-plan">
      {plan.minutes !== null && (
        <p className="hero-plan-estimate">
          <Clock3 size={14} aria-hidden="true" />About {plan.minutes} min at the planned rests
        </p>
      )}
      <ul className="hero-plan-list" aria-label="Exercises in this workout">
        {plan.rows.map(row => (
          <li key={row.key} className="hero-plan-row">
            <span className="hero-plan-name">{row.name}</span>
            {row.last && <span className="hero-plan-last"><span className="sr-only">Last time </span>{row.last}</span>}
          </li>
        ))}
      </ul>
      {plan.more > 0 && <p className="hero-plan-more">+{plan.more} more</p>}
    </div>
  );
}
