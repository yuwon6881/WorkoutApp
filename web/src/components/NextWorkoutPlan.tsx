import { useEffect, useMemo, useState } from 'react';
import { Clock3 } from 'lucide-react';
import type { Bootstrap, Template } from '../types';
import { api } from '../lib/api';
import { viewReadCache } from '../lib/viewReadCache';
import { nextWorkoutPlan } from '../lib/nextWorkoutPlan';
import type { ExerciseLastPerformed } from '../lib/lastPerformed';
import { Skeleton } from './ui/Skeleton';
import './NextWorkoutPlan.css';

type PlanReads = { template: Template; lastPerformed: ReadonlyMap<string, ExerciseLastPerformed> };

/// Reads the next workout's plan and each exercise's last top set for the Overview hero. Both are
/// optional detail: until they arrive, or if they cannot, the hero keeps its counts alone. Held in
/// the in-memory view cache so switching tabs does not read them again.
function usePlanReads(data: Bootstrap, templateId: string): PlanReads | 'unavailable' | null {
  const loaded = data.templates?.find(template => template.id === templateId && template.exercises.length > 0);
  const key = `${data.account.id}:next-plan:${templateId}`;
  const version = `${data.resourceVersions?.templates ?? ''}:${data.resourceVersions?.programs ?? ''}:${data.resourceVersions?.history ?? ''}`;
  const [reads, setReads] = useState<PlanReads | 'unavailable' | null>(() => viewReadCache.get<PlanReads>(key, version) ?? null);

  useEffect(() => {
    const cached = viewReadCache.get<PlanReads>(key, version);
    setReads(cached ?? null);
    if (cached && viewReadCache.fresh(key, version)) return;
    const controller = new AbortController();
    const template = loaded ? Promise.resolve(loaded) : api.getTemplate(templateId, controller.signal);
    const lastPerformed = api.lastPerformed(controller.signal)
      .then(list => new Map(list.map(row => [row.exerciseId, row])))
      .catch(() => new Map<string, ExerciseLastPerformed>());
    Promise.all([template, lastPerformed]).then(([plan, last]) => {
      if (controller.signal.aborted) return;
      const next = { template: plan, lastPerformed: last };
      viewReadCache.set(key, version, next);
      setReads(next);
    }).catch(() => {
      // Optional detail: the hero keeps its counts.
      if (!controller.signal.aborted) setReads('unavailable');
    });
    return () => controller.abort();
  }, [key, version, loaded]);

  return reads;
}

/// The next workout's length and opening exercises, so the hero answers "what am I doing today?"
/// without opening the preview.
export function NextWorkoutPlan({ data, templateId }: { data: Bootstrap; templateId: string }) {
  const reads = usePlanReads(data, templateId);
  const plan = useMemo(() => reads && reads !== 'unavailable'
    ? nextWorkoutPlan(reads.template, reads.lastPerformed, data.exercises, data.preferences.unit, data.preferences.restSeconds ?? 90)
    : null, [reads, data.exercises, data.preferences.unit, data.preferences.restSeconds]);

  // Rows are reserved while the plan is read, so the hero does not grow under the reader.
  if (reads === null) return (
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
