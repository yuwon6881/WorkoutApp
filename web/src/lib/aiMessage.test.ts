import { describe, expect, it } from 'vitest';
import { parseAiMessage, type AiBulletItem } from './aiMessage';

const item = (text: string, children: string[] = [], leadIn = false): AiBulletItem => ({ text, children, leadIn });

describe('parseAiMessage', () => {
  it('groups consecutive bullets into one list', () => {
    expect(parseAiMessage('- one\n- two\n• three')).toEqual([
      { kind: 'bullets', items: [item('one'), item('two'), item('three')] },
    ]);
  });

  it('keeps a numbered list together across blank lines and preserves its start', () => {
    expect(parseAiMessage('2. second\n\n3. third')).toEqual([{ kind: 'numbered', start: 2, items: ['second', 'third'] }]);
  });

  it('separates paragraphs at blank lines and keeps single line breaks inside one', () => {
    expect(parseAiMessage('first\nsame paragraph\n\nsecond')).toEqual([
      { kind: 'paragraph', lines: ['first', 'same paragraph'] },
      { kind: 'paragraph', lines: ['second'] },
    ]);
  });

  it('ends a list when prose follows and treats hashes as headings', () => {
    expect(parseAiMessage('### Volume\n- chest\nDone.')).toEqual([
      { kind: 'heading', text: 'Volume' },
      { kind: 'bullets', items: [item('chest')] },
      { kind: 'paragraph', lines: ['Done.'] },
    ]);
  });

  it('returns nothing for an empty reply', () => {
    expect(parseAiMessage('  \n')).toEqual([]);
  });

  describe('nested bullets', () => {
    it('nests indented bullets under the bullet above, marking a colon line as a lead-in', () => {
      const reply = [
        '- Chest: 19 primary sets across 3 sessions',
        '- Recent benching also included:',
        '  - Bench Press — 4 sets on 2026-10-13',
        '  - Pause Barbell Bench Press — 4 sets on 2026-10-16',
      ].join('\n');
      expect(parseAiMessage(reply)).toEqual([{
        kind: 'bullets',
        items: [
          item('Chest: 19 primary sets across 3 sessions'),
          item('Recent benching also included:', ['Bench Press — 4 sets on 2026-10-13', 'Pause Barbell Bench Press — 4 sets on 2026-10-16'], true),
        ],
      }]);
    });

    it('recognises a bold lead-in and a lead-in whose colon is outside the bold', () => {
      expect(parseAiMessage('- **Breakfast:**\n  - 2 eggs\n- **Lunch**:\n  - Rice')).toEqual([{
        kind: 'bullets',
        items: [item('**Breakfast:**', ['2 eggs'], true), item('**Lunch**:', ['Rice'], true)],
      }]);
    });

    it('keeps a bulleted parent that is not a lead-in', () => {
      expect(parseAiMessage('- Chest: 19 sets\n  - Bench Press')).toEqual([
        { kind: 'bullets', items: [item('Chest: 19 sets', ['Bench Press'])] },
      ]);
    });

    it('flattens anything deeper than one level into that bullet’s children', () => {
      expect(parseAiMessage('- a\n  - b\n    - c\n- d')).toEqual([
        { kind: 'bullets', items: [item('a', ['b', 'c']), item('d')] },
      ]);
    });

    it('reads tabs as indentation and keeps nesting across a blank line', () => {
      expect(parseAiMessage('- a\n\n\t- b')).toEqual([{ kind: 'bullets', items: [item('a', ['b'])] }]);
    });

    it('treats a list that starts indented as top level', () => {
      expect(parseAiMessage('  - a\n  - b')).toEqual([{ kind: 'bullets', items: [item('a'), item('b')] }]);
    });

    it('leaves a lead-in with no indented children as a label among its siblings', () => {
      expect(parseAiMessage('- Recent benching also included:\n- Bench Press')).toEqual([
        { kind: 'bullets', items: [item('Recent benching also included:', [], true), item('Bench Press')] },
      ]);
    });
  });
});
