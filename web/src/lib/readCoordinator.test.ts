import { describe, expect, it } from 'vitest';
import { ReadCoordinator } from './readCoordinator';

describe('account read coordination', () => {
  it('admits launch ahead of queued optional reads and cancels queued consumers immediately', async () => {
    const coordinator = new ReadCoordinator(1);
    let release!: () => void;
    const starts: string[] = [];
    const active = coordinator.run('active', undefined, () => new Promise<void>(resolve => { release = resolve; }));
    const optional = coordinator.run('optional', undefined, async () => { starts.push('optional'); }, 2);
    const cancelled = new AbortController();
    const queued = coordinator.run('cancelled', cancelled.signal, async () => { starts.push('cancelled'); });
    const launch = coordinator.run('launch', undefined, async () => { starts.push('launch'); }, 0);
    cancelled.abort();
    await expect(queued).rejects.toMatchObject({ name: 'AbortError' });
    release();
    await Promise.all([active, optional, launch]);
    expect(starts).toEqual(['launch', 'optional']);
  });

  it('keeps one optional read running while core reads retain the remaining slots', async () => {
    const coordinator = new ReadCoordinator(3);
    let release!: () => void;
    const starts: string[] = [];
    const optional = coordinator.run('optional', undefined, () => new Promise<void>(resolve => { release = resolve; }), 2);
    const second = coordinator.run('optional-2', undefined, async () => { starts.push('optional-2'); }, 2);
    const core = coordinator.run('core', undefined, async () => { starts.push('core'); });
    await core;
    expect(starts).toEqual(['core']);
    release();
    await Promise.all([optional, second]);
    expect(starts).toEqual(['core', 'optional-2']);
  });
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
