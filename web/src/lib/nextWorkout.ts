import type { Bootstrap } from '../types';

// Today's workout: the active program's next day, or the first saved routine without a program.
export function nextWorkout(data: Bootstrap) {
  const program = data.activeProgram;
  return program ? program.days.find(day => day.id === program.nextTemplateId) ?? null : data.templates[0] ?? null;
}
