import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { ImportUploadPanel } from './ImportUploadPanel';

it('labels an external draft as JSON without PDF privacy copy', () => {
  const html = renderToStaticMarkup(createElement(ImportUploadPanel, {
    hasDraft: true, external: true, fileName: 'plan.json', busy: false, onChooseFile: () => {}
  }));
  expect(html).toContain('Source JSON');
  expect(html).not.toContain('Source PDF');
  expect(html).not.toContain('How your PDF is read');
});
