import { describe, expect, it } from 'vitest';
import { getSupersetGroup, isSuperset, getSupersetPartners, pairExercises, unlinkExercise } from './supersets';

describe('supersets logic', () => {
  it('extracts superset group correctly', () => {
    expect(getSupersetGroup('A1')).toBe('A');
    expect(getSupersetGroup('b2')).toBe('B');
    expect(getSupersetGroup('C')).toBe('C');
    expect(getSupersetGroup('')).toBe('');
    expect(getSupersetGroup(null)).toBe('');
    expect(getSupersetGroup(undefined)).toBe('');
  });

  it('determines if exercise is in a superset', () => {
    expect(isSuperset('A1')).toBe(true);
    expect(isSuperset('')).toBe(false);
    expect(isSuperset(null)).toBe(false);
  });

  it('pairs two unlinked exercises into group A', () => {
    const exercises = [
      { id: '1', sequenceGroup: '' },
      { id: '2', sequenceGroup: '' },
      { id: '3', sequenceGroup: '' }
    ];

    const result = pairExercises(exercises, '1', '3');
    expect(result[0].sequenceGroup).toBe('A1');
    expect(result[1].sequenceGroup).toBe('');
    expect(result[2].sequenceGroup).toBe('A2');
  });

  it('pairs an unlinked exercise into an existing group', () => {
    const exercises = [
      { id: '1', sequenceGroup: 'A1' },
      { id: '2', sequenceGroup: 'A2' },
      { id: '3', sequenceGroup: '' }
    ];

    const result = pairExercises(exercises, '1', '3');
    expect(result[0].sequenceGroup).toBe('A1');
    expect(result[1].sequenceGroup).toBe('A2');
    expect(result[2].sequenceGroup).toBe('A3');
  });

  it('allocates next unused letter when pairing new group', () => {
    const exercises = [
      { id: '1', sequenceGroup: 'A1' },
      { id: '2', sequenceGroup: 'A2' },
      { id: '3', sequenceGroup: '' },
      { id: '4', sequenceGroup: '' }
    ];

    const result = pairExercises(exercises, '3', '4');
    expect(result[0].sequenceGroup).toBe('A1');
    expect(result[1].sequenceGroup).toBe('A2');
    expect(result[2].sequenceGroup).toBe('B1');
    expect(result[3].sequenceGroup).toBe('B2');
  });

  it('finds superset partners', () => {
    const exercises = [
      { id: '1', sequenceGroup: 'A1' },
      { id: '2', sequenceGroup: 'A2' },
      { id: '3', sequenceGroup: 'B1' }
    ];

    const partners = getSupersetPartners('1', exercises);
    expect(partners.map(p => p.id)).toEqual(['2']);
  });

  it('unlinks an exercise and clears orphan partner when only 1 remains', () => {
    const exercises = [
      { id: '1', sequenceGroup: 'A1' },
      { id: '2', sequenceGroup: 'A2' },
      { id: '3', sequenceGroup: '' }
    ];

    const result = unlinkExercise(exercises, '1');
    expect(result[0].sequenceGroup).toBe('');
    expect(result[1].sequenceGroup).toBe(''); // cleared because only 1 remained
  });

  it('unlinks an exercise and renumbers when 2 or more partners remain', () => {
    const exercises = [
      { id: '1', sequenceGroup: 'A1' },
      { id: '2', sequenceGroup: 'A2' },
      { id: '3', sequenceGroup: 'A3' }
    ];

    const result = unlinkExercise(exercises, '1');
    expect(result[0].sequenceGroup).toBe('');
    expect(result[1].sequenceGroup).toBe('A1');
    expect(result[2].sequenceGroup).toBe('A2');
  });
});
