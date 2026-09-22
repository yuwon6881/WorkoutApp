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

export function soundNow(): boolean {
  if (!primeAlarm() || !audio) return false;
  const { context } = audio;
  const start = context.currentTime + 0.05;
  for (const tone of CHIME) scheduled.push(playChimeTone(context, start + tone.offset, tone.frequency, tone.duration, tone.gain));
  return true;
}

export function testAlarmSound(): boolean {
  primeAlarm();
  return soundNow();
}
