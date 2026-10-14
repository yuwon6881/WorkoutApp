import type { Exercise } from '../types';

/// Exercise library search. Names are written many ways ("Pull-Up", "Pull up", "Pullup"), so a
/// plain substring test misses movements the user is plainly asking for. Matching is therefore
/// by word: each query word must land on a word, on two neighbouring words run together
/// ("pull" + "up" = "pullup"), or on a plural of either, and a query with no hit at all gets one
/// pass that forgives a single typo.

type SearchFields = Pick<Exercise, 'name' | 'aliases' | 'equipment' | 'muscle' | 'secondaryMuscles' | 'movementPattern'>;

export type ExerciseSearchIndex = { name: Terms; alias: Terms; other: Terms };
type Terms = { words: string[]; joined: string[] };

export function normalizeSearchText(value: string) {
  return value.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function termsOf(text: string): Terms {
  const words = normalizeSearchText(text).split(' ').filter(Boolean);
  // Joined neighbours only ever match by prefix, so "lup" cannot be found inside "pull up".
  return { words, joined: words.slice(1).map((word, index) => words[index] + word) };
}

export function buildExerciseSearchIndex(exercise: SearchFields): ExerciseSearchIndex {
  return {
    name: termsOf(exercise.name),
    alias: termsOf(exercise.aliases.join(' ')),
    other: termsOf([exercise.equipment, exercise.muscle, ...(exercise.secondaryMuscles ?? []), exercise.movementPattern ?? ''].join(' '))
  };
}

function singular(token: string) {
  return token.length > 2 && token.endsWith('s') && !token.endsWith('ss') ? token.slice(0, -1) : token;
}

/// One substitution, insertion, deletion, or swap of two neighbouring letters.
function withinOneEdit(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (i === a.length && i === b.length) return true;
  if (a.length === b.length) {
    return a.slice(i + 1) === b.slice(i + 1) || (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2));
  }
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : b.slice(i + 1) === a.slice(i);
}

function termMatches(terms: Terms, token: string, forgiving: boolean) {
  const hit = (form: string) => terms.words.some(word => word.includes(form))
    || terms.joined.some(term => term.startsWith(form))
    || forgiving && form.length >= 5 && [...terms.words, ...terms.joined].some(term => withinOneEdit(form, term.slice(0, form.length))
      || withinOneEdit(form, term.slice(0, form.length + 1)));
  if (hit(token)) return true;
  // A plural ("ups") falls back to its singular; a short singular must be a whole word so that
  // "abs" does not start matching every word containing "ab".
  const root = singular(token);
  if (root === token) return false;
  return root.length < 3 ? terms.words.includes(root) : hit(root);
}

/// Lower is better; undefined is no match. A hit in the name beats one in an alias, which beats
/// one in equipment or muscle, so searching "press" lists presses before exercises merely worked
/// by the same muscle.
export function exerciseSearchScore(index: ExerciseSearchIndex, query: string, forgiving = false): number | undefined {
  const tokens = normalizeSearchText(query).split(' ').filter(Boolean);
  if (!tokens.length) return 0;
  // "pull ups" must also find a movement written as the one word "Pullup", so each pair of
  // neighbouring query words is tried run together as well, keeping the best reading.
  const readings = [tokens, ...tokens.slice(1).map((token, i) => [...tokens.slice(0, i), tokens[i] + token, ...tokens.slice(i + 2)])];
  const scores = readings.flatMap(reading => scoreTokens(index, reading, forgiving) ?? []);
  return scores.length ? Math.min(...scores) : undefined;
}

function scoreTokens(index: ExerciseSearchIndex, tokens: string[], forgiving: boolean): number | undefined {
  let score = 0;
  for (const token of tokens) {
    if (termMatches(index.name, token, forgiving)) {
      const leading = index.name.words[0]?.startsWith(token) || index.name.joined[0]?.startsWith(token);
      score += leading ? 0 : 1;
    } else if (termMatches(index.alias, token, forgiving)) score += 2;
    else if (termMatches(index.other, token, forgiving)) score += 3;
    else return undefined;
  }
  return score;
}

/// Scores every exercise for a query. When nothing matches exactly the typo-forgiving pass runs,
/// so a misspelling still finds something while a correct query never returns near-misses.
export function searchExerciseScores(indexes: Map<string, ExerciseSearchIndex>, query: string): Map<string, number> {
  const scores = new Map<string, number>();
  const run = (forgiving: boolean) => {
    for (const [id, index] of indexes) {
      const score = exerciseSearchScore(index, query, forgiving);
      if (score !== undefined) scores.set(id, score);
    }
  };
  run(false);
  if (!scores.size && normalizeSearchText(query)) run(true);
  return scores;
}
