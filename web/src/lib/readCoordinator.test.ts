import { describe, expect, it } from 'vitest';
import { ReadCoordinator } from './readCoordinator';

describe('account read coordination', () => {
  it('shares a request without allowing one cancelled consumer to cancel another', async () => {
    const coordinator = new ReadCoordinator();
    const first = new AbortController();
    let finish!: (value: number) => void;
    let sharedSignal!: AbortSignal;
    let calls = 0;
    const load = (signal: AbortSignal) => { calls++; sharedSignal = signal; return new Promise<number>(resolve => { finish = resolve; }); };
    const a = coordinator.run('history', first.signal, load);
    const b = coordinator.run('history', undefined, load);
    first.abort();
    await expect(a).rejects.toMatchObject({ name: 'AbortError' });
    expect(sharedSignal.aborted).toBe(false);
    finish(42);
    await expect(b).resolves.toBe(42);
    expect(calls).toBe(1);
  });

  it('bounds concurrency and cancels old account requests on reset', async () => {
    const coordinator = new ReadCoordinator(1);
    const starts: string[] = [];
    const a = coordinator.run('old-account', undefined, signal => new Promise<string>((_resolve, reject) => {
      starts.push('old'); signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')));
    }));
    const b = coordinator.run('queued', undefined, async () => { starts.push('queued'); return 'wrong account'; });
    coordinator.reset();
    await expect(a).rejects.toMatchObject({ name: 'AbortError' });
    await expect(b).rejects.toMatchObject({ name: 'AbortError' });
    expect(starts).toEqual(['old']);
    await expect(coordinator.run('new-account', undefined, async () => 'new')).resolves.toBe('new');
  });
});
