import type { Bootstrap, Template } from '../types';

export function acknowledgeTemplate(data: Bootstrap, id: string, saved: Template | null): Bootstrap {
  const templates = saved ? data.templates.map(template => template.id === id ? saved : template)
    : data.templates.filter(template => template.id !== id);
  if (saved && !data.templates.some(template => template.id === id)) templates.push(saved);
  templates.sort((left, right) => left.week - right.week || left.position - right.position);
  return { ...data, templates,
    nextWorkout: data.activeProgram ? data.nextWorkout : templates[0] ? {
      ...templates[0], exerciseCount: templates[0].exercises.length
    } : null,
    navigationCounts: data.navigationCounts ? { ...data.navigationCounts, templates: templates.length } : undefined
  };
}
