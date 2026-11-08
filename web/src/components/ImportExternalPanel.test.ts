import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ImportExternalPanel } from './ImportExternalPanel';
import type { ExternalImportFailure } from './useImportPipeline';

const noop = () => {};

function render(overrides: { busy?: boolean; failure?: ExternalImportFailure | null; progress?: { label: string; detail: string; percent: null } | null } = {}) {
  return renderToStaticMarkup(createElement(ImportExternalPanel, {
    busy: false, failure: null, progress: null,
    onChooseFile: noop, onDropFile: noop, onSubmitText: noop, onDismissFailure: noop,
    ...overrides
  }));
}

describe('external import progress', () => {
  it('announces the file being checked', () => {
    const html = render({ busy: true, progress: { label: 'Checking the JSON file', detail: 'plan.json', percent: null } });
    expect(html).toContain('Checking the JSON file');
    expect(html).toContain('plan.json');
    expect(html).toContain('role="status"');
  });
});

describe('external import input options', () => {
  it('opens on a drop zone with a file picker, and offers pasting as the other choice', () => {
    const html = render();
    expect(html).toContain('Upload a file');
    expect(html).toContain('Paste the JSON');
    expect(html).toContain('Drop your JSON file here');
    expect(html).toContain('Choose a JSON file');
  });

  it('does not name a particular AI provider', () => {
    const html = render({ failure: { message: 'x', errors: [{ path: '$.a', message: 'Fix a.' }] } });
    expect(html).not.toMatch(/chatgpt/i);
    expect(html).toContain('Copy errors for your AI assistant');
  });
});

describe('external import failure', () => {
  it('shows a whole-file problem as one sentence with no path', () => {
    const html = render({ failure: { message: 'x', errors: [{ path: '$', message: 'The file is not complete, valid JSON near line 3, column 9.' }] } });
    expect(html).toContain('The file is not complete, valid JSON near line 3, column 9.');
    expect(html).not.toContain('iep-error-path');
    expect(html).not.toContain('That file needs');
  });

  it('shows the line the file breaks on, with a marker under the column', () => {
    const html = render({ failure: {
      message: 'x', errors: [{ path: '$', message: 'The file is not complete, valid JSON near line 463, column 14.' }],
      excerpt: { line: 463, column: 14, snippet: '  "sets": [1, 2,]', caret: 15 }
    } });
    expect(html).toContain('Line 463, near column 14 of your file');
    expect(html).toContain('&quot;sets&quot;: [1, 2,]');
    expect(html).toContain(`${' '.repeat(15)}^`);
  });

  it('lists located problems with their paths under a counted headline', () => {
    const html = render({ failure: { message: 'x', errors: [
      { path: '$.program.days[0].name', message: 'Add a workout name.' },
      { path: '$.program.days[1].key', message: 'Add a day key.' }
    ] } });
    expect(html).toContain('That file needs 2 changes before it can be imported.');
    expect(html).toContain('$.program.days[0].name');
    expect(html).toContain('Add a day key.');
  });
});
