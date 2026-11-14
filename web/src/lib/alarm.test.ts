import { afterEach, describe, expect, it, vi } from 'vitest';

/// A stand-in context that starts suspended, as the first one made in a gesture can be, and only
/// begins running (and ticking its clock) once resume() settles.
function installContext(startsRunning: boolean) {
  const starts: number[] = [];
  const instances: FakeContext[] = [];
  class FakeContext {
    state: 'suspended' | 'running' | 'closed' = startsRunning ? 'running' : 'suspended';
    currentTime = 0;
    destination = {};
    constructor() { instances.push(this); }
    resume() {
      return new Promise<void>(resolve => setTimeout(() => { this.state = 'running'; this.currentTime = 1; resolve(); }, 0));
    }
    close() { this.state = 'closed'; return Promise.resolve(); }
    createGain() {
      return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} };
    }
    createOscillator() {
      return { type: '', frequency: { value: 0 }, connect() {}, disconnect() {}, stop() {}, start: (at: number) => { starts.push(at); } };
    }
  }
  vi.stubGlobal('window', { AudioContext: FakeContext });
  return { starts, instances };
}

afterEach(async () => {
  const { releaseAlarm } = await import('./alarm');
  releaseAlarm();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('testAlarmSound', () => {
  it('waits for a freshly created context to run before scheduling the chime', async () => {
    const { starts } = installContext(false);
    const { testAlarmSound } = await import('./alarm');

    const played = await testAlarmSound();

    expect(played).toBe(true);
    // Scheduled against the running clock (1), not the suspended one (0) that swallowed the first press.
    expect(starts.length).toBeGreaterThan(0);
    expect(Math.min(...starts)).toBeGreaterThanOrEqual(1.1);
  });

  it('reports failure when the browser has no audio', async () => {
    vi.stubGlobal('window', {});
    const { testAlarmSound } = await import('./alarm');
    expect(await testAlarmSound()).toBe(false);
  });
});
