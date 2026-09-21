import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../../public/rest-alert-sw.js', import.meta.url), 'utf8');
const sessionId = '4b049de3-ecc3-42c4-bf66-6afae695ba91';
const generation = '81ce04b1-799f-48df-ae3c-07975209f252';

describe('rest alert service worker', () => {
  it('shows the notification when a visible same-origin window does not own the timer', async () => {
    const shown: unknown[] = [];
    const push = getPushHandler([visibleClient('https://workout.test/', false)], shown);

    await dispatch(push, { data: alertData() });

    expect(shown).toHaveLength(1);
  });

  it('suppresses only when a visible window claims the matching session and generation', async () => {
    const shown: unknown[] = [];
    const push = getPushHandler([visibleClient('https://workout.test/', true)], shown);

    await dispatch(push, { data: alertData() });

    expect(shown).toHaveLength(0);
  });

  it('fails open when a visible window cannot answer the bounded ownership query', async () => {
    const shown: unknown[] = [];
    const push = getPushHandler([{ visibilityState: 'visible', url: 'https://workout.test/', postMessage: () => undefined }], shown);

    await dispatch(push, { data: alertData() });

    expect(shown).toHaveLength(1);
  });
});

function getPushHandler(windows: unknown[], shown: unknown[]) {
  const handlers = new Map<string, (event: any) => void>();
  const self = {
    location: { origin: 'https://workout.test' },
    clients: { matchAll: async () => windows },
    registration: { showNotification: async (...args: unknown[]) => { shown.push(args); } },
    addEventListener: (type: string, listener: (event: any) => void) => handlers.set(type, listener)
  };
  class FakeMessageChannel {
    port1 = { onmessage: null as ((event: { data: unknown }) => void) | null, start() {}, close() {} };
    port2 = { postMessage: (data: unknown) => this.port1.onmessage?.({ data }), close() {} };
  }
  runInNewContext(source, { self, URL, MessageChannel: FakeMessageChannel, setTimeout, clearTimeout });
  return handlers.get('push')!;
}

function visibleClient(url: string, ownsTimer: boolean) {
  return {
    visibilityState: 'visible',
    url,
    postMessage: (request: { sessionId: string; generation: string }, ports: Array<{ postMessage: (data: unknown) => void }>) => {
      queueMicrotask(() => ports[0].postMessage({
        type: 'workout-rest-alert-owner-response',
        sessionId: ownsTimer ? request.sessionId : 'unrelated-session',
        generation: ownsTimer ? request.generation : 'unrelated-generation',
        ownsTimer
      }));
    }
  };
}

function alertData() {
  return {
    kind: 'workout-rest',
    sessionId,
    generation,
    route: `/?workout=${sessionId}`
  };
}

async function dispatch(push: (event: any) => void, payload: { data: Record<string, string> }) {
  let completion: Promise<unknown> | undefined;
  push({
    data: { json: () => payload },
    waitUntil: (promise: Promise<unknown>) => { completion = promise; }
  });
  await completion;
}
