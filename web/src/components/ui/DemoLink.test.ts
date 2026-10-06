import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DemoLink } from './DemoLink';

describe('DemoLink', () => {
  it('renders a tertiary demo button with play icon and aria-label', () => {
    const markup = renderToStaticMarkup(createElement(DemoLink, {
      url: 'https://youtu.be/SJqInYJcd6c',
      exerciseName: 'Egyptian Cable Lateral Raise'
    }));

    expect(markup).toContain('exercise-demo-pill');
    expect(markup).toContain('Demo');
    expect(markup).toContain('href="https://youtu.be/SJqInYJcd6c"');
    expect(markup).toContain('aria-label="Watch a demonstration of Egyptian Cable Lateral Raise"');
  });

  it('renders nothing when url is missing or empty', () => {
    const markupNull = renderToStaticMarkup(createElement(DemoLink, {
      url: null,
      exerciseName: 'Exercise'
    }));
    expect(markupNull).toBe('');

    const markupEmpty = renderToStaticMarkup(createElement(DemoLink, {
      url: '',
      exerciseName: 'Exercise'
    }));
    expect(markupEmpty).toBe('');
  });
});
