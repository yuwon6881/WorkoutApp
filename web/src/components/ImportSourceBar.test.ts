import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { ImportSourceBar } from './ImportSourceBar';

it('names the JSON file the draft came from and offers a replacement', () => {
  const html = renderToStaticMarkup(createElement(ImportSourceBar, {
    fileName: 'plan.json', busy: false, onChooseFile: () => {}
  }));
  expect(html).toContain('Source JSON');
  expect(html).toContain('plan.json');
  expect(html).toContain('Choose a JSON file');
  expect(html).not.toContain('PDF');
});
