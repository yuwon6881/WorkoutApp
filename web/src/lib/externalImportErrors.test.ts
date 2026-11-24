import { describe, expect, it } from 'vitest';
import { readFieldErrors } from './externalImportErrors';

describe('readFieldErrors', () => {
  it('extracts valid path and message pairs from untrusted error payloads', () => {
    expect(readFieldErrors({
      errors: [
        { path: '$.weeks[0]', message: 'Missing name.' },
        { path: 123, message: 'Bad path' },
        { path: '$.a' },
        null,
        'invalid',
      ],
    })).toEqual([{ path: '$.weeks[0]', message: 'Missing name.' }]);
  });

  it('returns empty array when errors field is absent or not an array', () => {
    for (const payload of [null, undefined, 'bad', {}, { errors: 'none' }, { errors: {} }]) {
      expect(readFieldErrors(payload)).toEqual([]);
    }
  });
});
