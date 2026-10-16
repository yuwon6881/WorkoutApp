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
    boundary.state = { failed: true, reloading: false, stale: false };

    const rendered = boundary.render();
    const html = renderToStaticMarkup(rendered as import('react').ReactElement);

    expect(html).toContain('role="alert"');
    expect(html).toContain('Workout');
    expect(html).toContain('This view needs a reload');
    expect(html).toContain('An active workout stays saved on this device. Reload to continue where you left off.');
    expect(html).toContain('Reload workout app');
    expect(html).toContain('Try again');
    expect(html).toContain('reload-recovery');
  });

  it('recognises a missing chunk after a deploy as an outdated version', () => {
    expect(ErrorBoundary.getDerivedStateFromError(new TypeError('Failed to fetch dynamically imported module: /assets/x.js')).stale).toBe(true);
    expect(ErrorBoundary.getDerivedStateFromError(new Error('Importing a module script failed.')).stale).toBe(true);
    expect(ErrorBoundary.getDerivedStateFromError(new Error('Cannot read properties of undefined')).stale).toBe(false);
  });

  // React.lazy keeps a rejected import, so re-rendering after a deploy throws the same error again
  // and Try again would only bring this screen straight back. Only a fresh shell recovers.
  it('offers only a reload when the failure is an outdated version', () => {
    const boundary = new ErrorBoundary({ children: createElement('div', null, 'Normal child') });
    boundary.state = { failed: true, reloading: false, stale: true };

    const html = renderToStaticMarkup(boundary.render() as import('react').ReactElement);

    expect(html).toContain('A new version is available');
    expect(html).toContain('Reload workout app');
    expect(html).not.toContain('Try again');
  });
});
