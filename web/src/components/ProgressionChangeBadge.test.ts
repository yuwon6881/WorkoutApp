import { describe, expect, it } from 'vitest';
import { Minus, Plus, Repeat, TrendingDown, TrendingUp } from 'lucide-react';
import { describeProgressionChange } from './ProgressionChangeBadge';

describe('describeProgressionChange', () => {
  it('shows a rep change with its icon as the only sign', () => {
    expect(describeProgressionChange({ kind: 'reps-up', deltaReps: 1 }, 'kg')).toMatchObject({ icon: Plus, text: '1 rep', spoken: 'add 1 rep' });
    expect(describeProgressionChange({ kind: 'reps-down', deltaReps: 2 }, 'kg')).toMatchObject({ icon: Minus, text: '2 reps', spoken: '2 fewer reps' });
  });

  it('pairs a load change trend arrow with a signed amount', () => {
    expect(describeProgressionChange({ kind: 'load-up', deltaKg: 2.5 }, 'kg')).toMatchObject({ icon: TrendingUp, text: '+2.5 kg' });
    expect(describeProgressionChange({ kind: 'load-down', deltaKg: 5 }, 'kg')).toMatchObject({ icon: TrendingDown, text: '−5 kg' });
  });

  it('never repeats a sign the icon already shows', () => {
    for (const change of [{ kind: 'reps-up', deltaReps: 3 }, { kind: 'reps-down', deltaReps: 1 }] as const)
      expect(describeProgressionChange(change, 'kg').text).toMatch(/^\d/);
    expect(describeProgressionChange({ kind: 'repeat' }, 'kg')).toMatchObject({ icon: Repeat, text: 'Repeat' });
  });
});
