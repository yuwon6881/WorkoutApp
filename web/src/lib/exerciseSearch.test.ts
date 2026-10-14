import { describe, expect, it } from 'vitest';
import { buildExerciseSearchIndex, searchExerciseScores } from './exerciseSearch';

const catalog = [
  { id: 'pullup', name: 'Pull-Up', aliases: ['Pullup'], equipment: 'Bodyweight', muscle: 'Back', secondaryMuscles: ['Biceps'] },
  { id: 'wide', name: 'Wide-Grip Pull-Up', aliases: [], equipment: 'Bodyweight', muscle: 'Back' },
  { id: 'two-grip', name: '2-Grip Pull-up', aliases: [], equipment: 'Bodyweight', muscle: 'Back' },
  { id: 'assisted', name: 'Assisted Pull-Up', aliases: [], equipment: 'Machine', muscle: 'Back' },
  { id: 'neutral', name: 'Neutral-Grip Pullup', aliases: [], equipment: 'Bodyweight', muscle: 'Back' },
  { id: 'pulldown', name: 'Lat Pulldown', aliases: [], equipment: 'Cable', muscle: 'Back' },
  { id: 'bench', name: 'Barbell Bench Press', aliases: [], equipment: 'Barbell', muscle: 'Chest', secondaryMuscles: ['Triceps'] },
  { id: 'dumbbell-press', name: 'Dumbbell Shoulder Press', aliases: [], equipment: 'Dumbbell', muscle: 'Shoulders' }
];

const indexes = new Map(catalog.map(exercise => [exercise.id, buildExerciseSearchIndex(exercise)]));
const ids = (query: string) => [...searchExerciseScores(indexes, query)].map(([id]) => id).sort();

describe('exercise search', () => {
  const pullUps = ['assisted', 'neutral', 'pullup', 'two-grip', 'wide'];

  it('finds every pull-up however the query spaces or hyphenates it', () => {
    for (const query of ['pullup', 'pull-up', 'pull up', 'Pull Up', 'pullups', 'pull-ups', 'pullu', 'pull u']) {
      expect(ids(query), query).toEqual(expect.arrayContaining(pullUps));
    }
  });

  it('matches a run-together name only from its start', () => {
    // "pull up" is joined to "pullup" for matching, but "lup" must not be found inside that join.
    expect(ids('lup')).not.toContain('two-grip');
    expect(ids('lup')).not.toContain('wide');
  });

  it('does not match a pulldown when the query names a pull-up', () => {
    expect(ids('pullup')).not.toContain('pulldown');
  });

  it('matches words in any order and across fields', () => {
    expect(ids('press bench')).toEqual(['bench']);
    expect(ids('chest barbell')).toEqual(['bench']);
    expect(ids('triceps')).toEqual(['bench']);
  });

  it('ranks a name hit ahead of an equipment or muscle hit', () => {
    const scores = searchExerciseScores(indexes, 'back');
    expect(scores.get('pullup')).toBeGreaterThan(0);
    const press = searchExerciseScores(indexes, 'press');
    expect(press.get('bench')).toBeLessThanOrEqual(press.get('dumbbell-press')!);
  });

  it('forgives a single typo only when nothing matches exactly', () => {
    expect(ids('dumbell')).toEqual(['dumbbell-press']);
    expect(ids('barbel')).toEqual(['bench']);
    expect(ids('bench pres')).toEqual(['bench']);
    expect(ids('zzzzz')).toEqual([]);
  });

  it('treats an empty query as matching everything', () => {
    expect(ids('')).toHaveLength(catalog.length);
    expect(ids('   ')).toHaveLength(catalog.length);
  });
});
