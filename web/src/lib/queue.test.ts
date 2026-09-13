import { describe, expect, it } from 'vitest';
import { ApiError } from './api';
import { SaveQueue } from './queue';

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

describe('the save pipeline', () => {
  it('sends writes one at a time, in the order they were made', async () => {
    const queue = new SaveQueue();
    const order: string[] = [];
    let running = 0;
    const task = (name: string) => async () => {
      running++;
      expect(running).toBe(1);
      await settle();
      order.push(name);
      running--;
    };
    queue.push('a', task('a'));
    queue.push('b', task('b'));
    queue.push('c', task('c'));
    while (queue.unsaved) await settle();
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('replaces a queued write with the newest one for the same key', async () => {
    const queue = new SaveQueue();
    const sent: string[] = [];
    queue.push('block', async () => { await settle(); sent.push('first'); });
    queue.push('workout', async () => { sent.push('stale'); });
    queue.push('workout', async () => { sent.push('latest'); });
    while (queue.unsaved) await settle();
    // The in-flight task still completes; only the waiting duplicate is superseded.
    expect(sent).toEqual(['first', 'latest']);
  });

  it('reports saved once the queue empties', async () => {
    const queue = new SaveQueue();
    queue.push('a', async () => { await settle(); });
    expect(queue.current.state).toBe('saving');
    while (queue.unsaved) await settle();
    expect(queue.current.state).toBe('saved');
  });

  it('stops the pipeline on failure rather than saving work composed against rejected state', async () => {
    const queue = new SaveQueue();
    const sent: string[] = [];
    queue.push('a', async () => { throw new ApiError('This changed on another device.', 409); });
    queue.push('b', async () => { sent.push('b'); });
    await settle(); await settle();
    expect(sent).toEqual([]);
    expect(queue.current.state).toBe('failed');
    expect(queue.current.message).toContain('another device');
  });

  it('distinguishes being signed out and being offline from an ordinary failure', async () => {
    const signedOut = new SaveQueue();
    signedOut.push('a', async () => { throw new ApiError('Session expired.', 401); });
    await settle(); await settle();
    expect(signedOut.current.state).toBe('signed-out');

    const offline = new SaveQueue();
    offline.push('a', async () => { throw new ApiError('No connection.', 0); });
    await settle(); await settle();
    expect(offline.current.state).toBe('offline');
  });

  it('knows while work has not reached the server', async () => {
    const queue = new SaveQueue();
    expect(queue.unsaved).toBe(false);
    queue.push('a', async () => { await settle(); });
    expect(queue.unsaved).toBe(true);
    while (queue.unsaved) await settle();
    expect(queue.unsaved).toBe(false);
  });

  it('notifies subscribers of the current state', async () => {
    const queue = new SaveQueue();
    const states: string[] = [];
    const stop = queue.subscribe(status => states.push(status.state));
    queue.push('a', async () => { await settle(); });
    while (queue.unsaved) await settle();
    stop();
    expect(states[0]).toBe('idle');
    expect(states).toContain('saving');
    expect(states.at(-1)).toBe('saved');
  });
});
