import { describe, expect, it } from 'vitest';
import { importFailureSteps, importIssueCopy } from './importIssueCopy';

describe('import issue copy', () => {
  it('names a known issue in plain words instead of its code', () => {
    const copy = importIssueCopy('working_set_instruction_conflict', 'The note describes working set 3, but the table prints 2 working sets.');
    expect(copy.title).toBe('The note and the set count disagree');
    expect(copy.kind).toBe('source');
    expect(copy.title).not.toContain('_');
  });

  it('heads an unknown issue with the first sentence of its message', () => {
    expect(importIssueCopy('something_new', 'A new check found a problem. More detail follows.').title)
      .toBe('A new check found a problem');
    expect(importIssueCopy('something_new', '').title).toBe('Check this item');
  });

  it('points the first step at the page the read doubted', () => {
    expect(importFailureSteps(29)[0]).toContain('page 29');
    expect(importFailureSteps(null)[0]).not.toMatch(/page \d/);
    expect(importFailureSteps(29)).toHaveLength(3);
  });
});
