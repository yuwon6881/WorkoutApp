import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
    boundary.state = { failed: true, reloading: false, stale: false, detail: null };

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
    boundary.state = { failed: true, reloading: false, stale: true, detail: null };

    const html = renderToStaticMarkup(boundary.render() as import('react').ReactElement);

    expect(html).toContain('A new version is available');
    expect(html).toContain('Reload workout app');
    expect(html).not.toContain('Try again');
  });

  afterEach(() => vi.unstubAllGlobals());

  // A lazy view's stylesheet disappears in a deploy just as its script does.
  it('recognises a missing view stylesheet as an outdated version while online', () => {
    vi.stubGlobal('navigator', { onLine: true });
    expect(ErrorBoundary.getDerivedStateFromError(new Error('This view could not load its styles. Reconnect and retry.')).stale).toBe(true);
    expect(ErrorBoundary.getDerivedStateFromError(new Error('Unable to preload CSS for /assets/Settings-x.css')).stale).toBe(true);
  });

  it('keeps a missing file offline as a connection failure, not a new version', () => {
    vi.stubGlobal('navigator', { onLine: false });
    expect(ErrorBoundary.getDerivedStateFromError(new Error('This view could not load its styles. Reconnect and retry.')).stale).toBe(false);
  });

  it('shows what failed in a technical detail disclosure', () => {
    const boundary = new ErrorBoundary({ children: createElement('div', null, 'Normal child') });
    boundary.state = ErrorBoundary.getDerivedStateFromError(new Error('Cannot read properties of undefined'));

    const html = renderToStaticMarkup(boundary.render() as import('react').ReactElement);

    expect(html).toContain('Technical detail');
    expect(html).toContain('Cannot read properties of undefined');
  });
});
