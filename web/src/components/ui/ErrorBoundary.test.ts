import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

describe('ErrorBoundary', () => {
  it('renders children when no error occurs', () => {
    const html = renderToStaticMarkup(
      createElement(ErrorBoundary, null, createElement('div', null, 'Everything is fine'))
    );
    expect(html).toContain('Everything is fine');
  });

  it('renders enhanced reload view with branding and actions when failed state is active', () => {
    const boundary = new ErrorBoundary({ children: createElement('div', null, 'Normal child') });
    boundary.state = { failed: true, reloading: false };

    const rendered = boundary.render();
    const html = renderToStaticMarkup(rendered as import('react').ReactElement);

    expect(html).toContain('role="alert"');
    expect(html).toContain('WORKOUT');
    expect(html).toContain('This view needs a reload');
    expect(html).toContain('An active workout stays saved on this device. Reload to continue where you left off.');
    expect(html).toContain('Reload workout app');
    expect(html).toContain('Try again');
    expect(html).toContain('reload-recovery');
  });
});
