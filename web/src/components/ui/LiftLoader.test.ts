import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LiftLoader } from './LiftLoader';
import { WorkoutStartingContent } from '../WorkoutStarting';
import { ImportExternalPanel } from '../ImportExternalPanel';

const noop = () => {};

describe('LiftLoader', () => {
  it('is decorative and takes its size class', () => {
    const html = renderToStaticMarkup(createElement(LiftLoader, { size: 'sm' }));
    expect(html).toContain('lift-loader-sm');
    expect(html).toContain('aria-hidden="true"');
  });

  it('uses only theme tokens', () => {
    const css = readFileSync(new URL('./LiftLoader.css', import.meta.url), 'utf8');
    expect(css).toContain('var(--accent)');
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
  });

  it('shows while a workout starts, with its status announced', () => {
    const html = renderToStaticMarkup(createElement(WorkoutStartingContent, { name: 'Push' }));
    expect(html).toContain('lift-loader');
    expect(html).toContain('Starting workout');
  });

  it('shows while an import is checked and is gone when progress clears', () => {
    const props = { busy: true, failure: null, onChooseFile: noop, onDropFile: noop, onSubmitText: noop, onDismissFailure: noop };
    const busy = renderToStaticMarkup(createElement(ImportExternalPanel, { ...props, progress: { label: 'Checking the JSON file', detail: 'a.json' } }));
    expect(busy).toContain('lift-loader');
    const done = renderToStaticMarkup(createElement(ImportExternalPanel, { ...props, busy: false, progress: null }));
    expect(done).not.toContain('lift-loader');
  });
});
