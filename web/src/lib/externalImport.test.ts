import { describe, expect, it } from 'vitest';
import {
  MAX_EXTERNAL_IMPORT_BYTES, checkExternalImportFile, checkExternalImportText, correctionRequest, describeFailure, locateParseError,
  readFieldErrors
} from './externalImport';

describe('locateParseError', () => {
  const message = (line: number, column: number) => `The file is not complete, valid JSON near line ${line}, column ${column}. It may have been cut off.`;

  it('finds the line and the character the server pointed at', () => {
    const text = '{\n  "name": "A",\n  "sets": [1, 2,]\n}';
    const found = locateParseError(message(3, 17), text);
    expect(found).toMatchObject({ line: 3, column: 17, snippet: '  "sets": [1, 2,]' });
    expect(found!.snippet[found!.caret]).toBe(']');
  });

  it('counts the column in UTF-8 bytes, as the server does', () => {
    // "é" is two bytes, so the byte column after it is one further than the character column.
    const found = locateParseError(message(1, 8), '{"é": x}');
    expect(found!.snippet[found!.caret]).toBe('x');
  });

  it('works on Windows line endings and ignores a leading byte-order mark', () => {
    const found = locateParseError(message(2, 3), '﻿{\r\n  oops\r\n}');
    expect(found).toMatchObject({ line: 2, snippet: '  oops' });
  });

  it('shows a window around a very long line instead of the whole line', () => {
    const line = `{"a":"${'x'.repeat(500)}" y}`;
    const found = locateParseError(message(1, 509), line)!;
    expect(found.snippet.length).toBeLessThan(120);
    expect(found.snippet.startsWith('…')).toBe(true);
    expect(found.snippet[found.caret]).toBe('y');
  });

  it.each([
    ['a message with no position', 'The file is empty.', '{}'],
    ['a line the text does not have', 'valid JSON near line 9, column 1.', '{}']
  ])('returns null for %s', (_name, text, body) => {
    expect(locateParseError(text, body)).toBeNull();
  });
});

describe('checkExternalImportText', () => {
  it('accepts pasted JSON', () => {
    expect(checkExternalImportText('{"version":1}')).toBeNull();
  });

  it.each(['', '   \n\t'])('refuses empty or blank text %j', text => {
    expect(checkExternalImportText(text)).toEqual(expect.any(String));
  });

  it('measures bytes, not characters, against the limit', () => {
    const justUnder = 'é'.repeat(MAX_EXTERNAL_IMPORT_BYTES / 2);
    const justOver = justUnder + 'é';
    expect(checkExternalImportText(justUnder)).toBeNull();
    expect(checkExternalImportText(justOver)).toEqual(expect.any(String));
  });
});

describe('describeFailure', () => {
  it('shows a message with no located problems as its own sentence', () => {
    expect(describeFailure({ message: 'Too big.', errors: [] })).toEqual({ headline: 'Too big.', items: [] });
  });

  it.each(['$', ''])('shows a single whole-file problem (path %j) as just its sentence', path => {
    expect(describeFailure({ message: 'x', errors: [{ path, message: 'The file is not valid JSON.' }] }))
      .toEqual({ headline: 'The file is not valid JSON.', items: [] });
  });

  it('lists located problems under a counted headline', () => {
    const errors = [{ path: '$.a', message: 'Fix a.' }, { path: '$.b', message: 'Fix b.' }];
    expect(describeFailure({ message: 'x', errors })).toEqual({ headline: 'That file needs 2 changes before it can be imported.', items: errors });
    expect(describeFailure({ message: 'x', errors: [errors[0]] }).headline).toBe('That file needs one change before it can be imported.');
  });
});

describe('checkExternalImportFile', () => {
  it('accepts a json file of a normal size', () => {
    expect(checkExternalImportFile({ name: 'plan.JSON', size: 1200 })).toBeNull();
  });

  it.each([
    ['plan.pdf', 1200],
    ['plan.json.txt', 1200],
    ['plan.json', 0],
    ['plan.json', MAX_EXTERNAL_IMPORT_BYTES + 1]
  ])('refuses %s of %i bytes with advice the user can act on', (name, size) => {
    expect(checkExternalImportFile({ name, size })).toEqual(expect.any(String));
  });

  it('allows a file exactly at the limit', () => {
    expect(checkExternalImportFile({ name: 'plan.json', size: MAX_EXTERNAL_IMPORT_BYTES })).toBeNull();
  });
});

describe('readFieldErrors', () => {
  it('keeps well-formed entries and drops anything else', () => {
    expect(readFieldErrors({ errors: [{ path: '$.a', message: 'Fix a.' }, { path: 3 }, null, 'x', { message: 'no path' }] }))
      .toEqual([{ path: '$.a', message: 'Fix a.' }]);
  });

  it.each([null, undefined, 'text', {}, { errors: 'nope' }])('returns nothing for %o', payload => {
    expect(readFieldErrors(payload)).toEqual([]);
  });
});

describe('correctionRequest', () => {
  const errors = [
    { path: '$.program.days[2].exercises[0].sets', message: 'Add at least one set.' },
    { path: '$.program.days[3].name', message: 'Add a workout name.' }
  ];

  it('numbers every problem with its location and asks for the complete corrected file', () => {
    const text = correctionRequest(errors, 'external-json-v1');
    expect(text).toContain('1. $.program.days[2].exercises[0].sets - Add at least one set.');
    expect(text).toContain('2. $.program.days[3].name - Add a workout name.');
    expect(text).toContain('complete corrected JSON file');
    expect(text).toContain('external-json-v1');
    expect(text).toContain('instead of guessing');
  });

  it('names a whole-file problem in words instead of showing a bare $', () => {
    const text = correctionRequest([{ path: '$', message: 'The file is not complete, valid JSON.' }]);
    expect(text).toContain('1. The whole file - The file is not complete, valid JSON.');
    expect(text).not.toContain('$ -');
  });

  it('quotes the text near a syntax error so the assistant can find it', () => {
    const text = correctionRequest([{ path: '$', message: 'Not valid JSON.' }], undefined,
      { line: 463, column: 14, snippet: '  "sets": [1, 2,]', caret: 15 });
    expect(text).toContain('near line 463, column 14, which reads:   "sets": [1, 2,]');
  });

  it('omits the version when the prompt was never loaded', () => {
    expect(correctionRequest(errors)).not.toContain('format instructions');
  });
});
