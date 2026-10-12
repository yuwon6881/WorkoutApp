import type { Bootstrap } from '../types';

// Today's workout: explicit server assignment, the active program's next day,
// or the active standalone workout (suppressed if completed) falling back to the first library routine.
export function nextWorkout(data: Bootstrap) {
  if (data.nextWorkout !== undefined) return data.nextWorkout;
  const program = data.activeProgram;
  if (program) return program.days.find(day => day.id === program.nextTemplateId) ?? null;
  const activeTemplate = data.templates?.find(template => template.active && !template.programId) ?? data.templates?.find(template => template.active);
  if (activeTemplate) return activeTemplate.activeCompletedAt ? null : activeTemplate;
  return data.templates?.[0] ?? null;
}
