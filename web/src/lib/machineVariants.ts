import type { Exercise } from '../types';

const normalized = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const stackPrefix = 'weight-stack-';

/** Resolve a written name, expanding a generic alias only when the catalog has both builds. */
export function exercisesForWrittenName(name: string, library: Exercise[]): Exercise[] {
  const key = normalized(name);
  const matches = library.filter(e => [e.name, ...e.aliases].some(value => normalized(value) === key));
  const ids = new Set(matches.map(e => e.id));
  if (/\b(?:plate loaded|weight stack|selectorized|selectorised)\b/.test(key)) return matches;
  for (const plate of matches) {
    if (!plate.slug || normalized(plate.name) === key || plate.slug.startsWith(stackPrefix)) continue;
    const stack = library.find(e => e.slug === stackPrefix + plate.slug);
    if (stack) ids.add(stack.id);
  }
  return library.filter(e => ids.has(e.id));
}
