import type { Bootstrap, Template } from '../types';
import { nextWorkout } from './nextWorkout';

export function acknowledgeTemplate(data: Bootstrap, id: string, saved: Template | null): Bootstrap {
  const templates = saved ? data.templates.map(template => template.id === id ? saved : template)
    : data.templates.filter(template => template.id !== id);
  if (saved && !data.templates.some(template => template.id === id)) templates.push(saved);
  templates.sort((left, right) => left.week - right.week || left.position - right.position);
  const candidate = nextWorkout({ ...data, templates, nextWorkout: undefined });
  const selected = candidate && ('exercises' in candidate ? { ...candidate, exerciseCount: candidate.exercises.length } : candidate);
  return { ...data, templates,
    nextWorkout: data.activeProgram ? data.nextWorkout
      : data.nextWorkout && data.nextWorkout.id !== id ? data.nextWorkout
      : selected,
    navigationCounts: data.navigationCounts ? { ...data.navigationCounts, templates: templates.length } : undefined
  };
}
