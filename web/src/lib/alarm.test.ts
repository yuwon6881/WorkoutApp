import { afterEach, describe, expect, it, vi } from 'vitest';

const CHIME_MIN_HZ = 500;

type Started = { frequency: number; at: number };

/// A stand-in context that starts suspended, as the first one made in a gesture can be, and only
/// begins running (with a clock at 1 s) once resume() settles.
function installContext() {
  const started: Started[] = [];
  class FakeContext {
    state: 'suspended' | 'running' | 'closed' = 'suspended';
    currentTime = 0;
    destination = {};
    resume() {
      return new Promise<void>(resolve => setTimeout(() => { this.state = 'running'; this.currentTime = 1; resolve(); }, 0));
    }
    close() { this.state = 'closed'; return Promise.resolve(); }
    createGain() {
      return { gain: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} };
    }
    createOscillator() {
      const oscillator = {
        type: '', frequency: { value: 0 }, connect() {}, disconnect() {}, stop() {},
        start: (at: number) => { started.push({ frequency: oscillator.frequency.value, at }); }
      };
      return oscillator;
    }
  }
  vi.stubGlobal('window', { AudioContext: FakeContext });
  return started;
}

const chimeStarts = (started: Started[], from = 0) =>
  started.slice(from).filter(tone => tone.frequency >= CHIME_MIN_HZ).map(tone => tone.at);

afterEach(async () => {
  const { releaseAlarm } = await import('./alarm');
  releaseAlarm();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('testAlarmSound', () => {
  it('waits for the context to run, then gives a cold output time to wake before the chime', async () => {
    const started = installContext();
    const { testAlarmSound } = await import('./alarm');

    expect(await testAlarmSound()).toBe(true);

    // Scheduled against the running clock (1), not the suspended one (0) that swallowed the first press,
    // and after a near-silent tone that keeps the idle output streaming.
    expect(started.some(tone => tone.frequency < CHIME_MIN_HZ)).toBe(true);
    expect(Math.min(...chimeStarts(started))).toBeGreaterThanOrEqual(1.8);
  });

  it('starts the chime soon once the output has been awake for a while', async () => {
    vi.useFakeTimers({ toFake: ['performance'] });
    const started = installContext();
    const { testAlarmSound } = await import('./alarm');

    await testAlarmSound();
    vi.advanceTimersByTime(2000);
    const before = started.length;
    await testAlarmSound();

    expect(started.slice(before).some(tone => tone.frequency < CHIME_MIN_HZ)).toBe(false);
    const second = chimeStarts(started, before);
    expect(Math.min(...second)).toBeLessThan(1.5);
  });

  it('lets a touch on the screen wake the output so the press after it needs a shorter lead', async () => {
    vi.useFakeTimers({ toFake: ['performance'] });
    const started = installContext();
    const { testAlarmSound, warmAlarm } = await import('./alarm');

    warmAlarm();
    await vi.waitFor(() => expect(started.some(tone => tone.frequency < CHIME_MIN_HZ)).toBe(true));
    vi.advanceTimersByTime(600);
    const before = started.length;
    await testAlarmSound();

    // 600 ms of the 800 ms wake-up already streamed, so only the remainder is added.
    const [first] = chimeStarts(started, before);
    expect(first).toBeLessThan(1.4);
    expect(first).toBeGreaterThanOrEqual(1.15);
  });

  it('reports failure when the browser has no audio', async () => {
    vi.stubGlobal('window', {});
    const { testAlarmSound } = await import('./alarm');
    expect(await testAlarmSound()).toBe(false);
  });
});
