import { describe, expect, it } from 'vitest';
import { parseAiMessage } from './aiMessage';

describe('parseAiMessage', () => {
  it('groups consecutive bullets into one list', () => {
    expect(parseAiMessage('- one\n- two\n• three')).toEqual([{ kind: 'bullets', items: ['one', 'two', 'three'] }]);
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
      { kind: 'bullets', items: ['chest'] },
      { kind: 'paragraph', lines: ['Done.'] },
    ]);
  });

  it('returns nothing for an empty reply', () => {
    expect(parseAiMessage('  \n')).toEqual([]);
  });
});
