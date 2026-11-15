/// Web Audio may keep a scheduled chime audible when a supported browser locks the screen, but
/// it cannot keep the PWA alive after the browser terminates it. The caller also keeps a visible
/// deadline, so returning to the app settles missed alerts without replaying an old alarm.

type AlarmAudio = { context: AudioContext };

let audio: AlarmAudio | null = null;
let scheduled: OscillatorNode[] = [];

type ToneSpec = {
  frequency: number;
  offset: number;
  duration: number;
  gain: number;
};

/// Soothing two-note acoustic chime (C5 -> E5) with soft harmonic shimmer and natural exponential decay.
const CHIME: readonly ToneSpec[] = [
  // First note: C5 fundamental + soft octave overtone
  { frequency: 523.25, offset: 0, duration: 0.65, gain: 0.11 },
  { frequency: 1046.5, offset: 0, duration: 0.28, gain: 0.02 },
  // Second note: E5 fundamental + soft octave overtone
  { frequency: 659.25, offset: 0.18, duration: 0.85, gain: 0.12 },
  { frequency: 1318.5, offset: 0.18, duration: 0.32, gain: 0.025 }
] as const;

const TEST_CHIME_LEAD_SECONDS = 0.15;
/// A speaker, Bluetooth sink or WebView output that has been idle takes a moment to wake and drops
/// the start of whatever is sent first, which for a one-second chime is most of it. A cold output is
/// kept streaming near-silence for this long before the chime; a recently used one needs only the
/// short lead.
const COLD_LEAD_SECONDS = 0.8;
const COLD_AFTER_MS = 8000;
const WAKE_GAIN = 0.0002;

let awakeSince: number | null = null;
let lastOutputAt = 0;

/// Seconds of output already streaming since the device last woke; zero when it has gone cold.
function warmthSeconds(now: number): number {
  return awakeSince === null || now - lastOutputAt > COLD_AFTER_MS ? 0 : (now - awakeSince) / 1000;
}

function chimeLeadSeconds(now: number): number {
  return Math.min(COLD_LEAD_SECONDS, Math.max(TEST_CHIME_LEAD_SECONDS, COLD_LEAD_SECONDS - warmthSeconds(now)));
}

function playWakeTone(context: AudioContext, seconds: number): void {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.frequency.value = 180;
  gain.gain.value = WAKE_GAIN;
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(context.currentTime);
  oscillator.stop(context.currentTime + seconds);
  scheduled.push(oscillator);
}

function markOutput(now: number, waking: boolean): void {
  if (waking || awakeSince === null || now - lastOutputAt > COLD_AFTER_MS) awakeSince = now;
  lastOutputAt = now;
}

/// Call from a user gesture because browsers block audio-context startup outside user input.
export function primeAlarm(): boolean {
  if (audio) { void audio.context.resume(); return audio.context.state !== 'closed'; }
  const Constructor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Constructor) return false;
  try {
    const context = new Constructor();
    void context.resume();
    audio = { context };
    return true;
  } catch { return false; }
}

export function scheduleAlarm(atEpochMs: number): boolean {
  cancelAlarm();
  if (!primeAlarm() || !audio) return false;
  const { context } = audio;
  const delay = (atEpochMs - Date.now()) / 1000;
  if (delay < 0) return false;
  const start = context.currentTime + delay;
  for (const tone of CHIME) scheduled.push(playChimeTone(context, start + tone.offset, tone.frequency, tone.duration, tone.gain));
  return true;
}

function playChimeTone(context: AudioContext, at: number, frequency: number, duration: number, peakGain: number): OscillatorNode {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.value = frequency;

  // Gentle 20ms attack to avoid clicks, followed by a natural acoustic exponential decay
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.linearRampToValueAtTime(peakGain, at + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0005, at + duration);
  gain.gain.linearRampToValueAtTime(0, at + duration + 0.01);

  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(at);
  oscillator.stop(at + duration + 0.02);
  return oscillator;
}

export function cancelAlarm(): void {
  for (const oscillator of scheduled) { try { oscillator.stop(); oscillator.disconnect(); } catch { /* already finished */ } }
  scheduled = [];
}

export function releaseAlarm(): void {
  cancelAlarm();
  if (!audio) return;
  try { void audio.context.close(); } catch { /* already closed */ }
  audio = null;
}

/// A context created a moment ago is still starting: its clock has not begun and the output device
/// has not woken, so a chime scheduled onto it right away is swallowed. Waits for it to run.
async function runningContext(): Promise<AudioContext | null> {
  if (!primeAlarm() || !audio) return null;
  const { context } = audio;
  if (context.state !== 'running') {
    try { await context.resume(); } catch { return null; }
  }
  return context.state === 'running' ? context : null;
}

export function soundNow(): boolean {
  if (!primeAlarm() || !audio) return false;
  const { context } = audio;
  const start = context.currentTime + 0.05;
  for (const tone of CHIME) scheduled.push(playChimeTone(context, start + tone.offset, tone.frequency, tone.duration, tone.gain));
  return true;
}

/// The first press of Test sound creates the audio context, so the chime waits until it is running
/// and starts a little later than a rest alert does, to give the output device time to wake.
export async function testAlarmSound(): Promise<boolean> {
  const context = await runningContext();
  if (!context) return false;
  const now = performance.now();
  const lead = chimeLeadSeconds(now);
  if (lead > TEST_CHIME_LEAD_SECONDS) {
    playWakeTone(context, lead);
    markOutput(now, warmthSeconds(now) === 0);
  } else markOutput(now, false);
  const start = context.currentTime + lead;
  for (const tone of CHIME) scheduled.push(playChimeTone(context, start + tone.offset, tone.frequency, tone.duration, tone.gain));
  return true;
}

/// Starts waking the output ahead of a Test sound press. Call from a user gesture on the screen that
/// offers the test, so the press that follows finds the device already streaming.
export function warmAlarm(): void {
  const now = performance.now();
  if (warmthSeconds(now) > 0) return;
  void runningContext().then(context => {
    if (!context || warmthSeconds(performance.now()) > 0) return;
    playWakeTone(context, 1);
    markOutput(performance.now(), true);
  });
}
