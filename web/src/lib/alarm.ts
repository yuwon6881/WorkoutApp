/// The sound the rest timer makes, and the one piece of this app that has to survive a locked
/// phone. A JavaScript timer is frozen the moment the browser backgrounds the tab, so the tone
/// is not played by a callback at the deadline: it is handed to the audio hardware in advance,
/// scheduled against the audio clock, which keeps running while the screen is off. A silent
/// loop holds the audio session open so the browser does not suspend the context along with
/// the rest of the page.
///
/// None of this can outlive the browser killing the tab outright. When that happens the timer
/// is still correct on return, and the user is told what they missed rather than left guessing.

type Audio = { context: AudioContext; keepAlive: AudioBufferSourceNode };

let audio: Audio | null = null;
let scheduled: OscillatorNode[] = [];

const CHIME = [
  { frequency: 659.25, offset: 0, duration: 0.24, gain: 0.14 },
  { frequency: 880, offset: 0.16, duration: 0.34, gain: 0.16 }
] as const;

/// Browsers only allow audio to start inside a real user gesture, so this is called from the
/// tap that starts the rest, not from the timer. Calling it again is free.
export function primeAlarm(): boolean {
  if (audio) { void audio.context.resume(); return true; }
  const Constructor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Constructor) return false;
  try {
    const context = new Constructor();
    void context.resume();
    audio = { context, keepAlive: startKeepAlive(context) };
    return true;
  } catch { return false; }
}

/// A near-silent loop. Exact digital silence is discarded by some platforms as nothing to play,
/// which is precisely the suspension this exists to prevent, so the samples are audibly zero
/// rather than numerically zero.
function startKeepAlive(context: AudioContext): AudioBufferSourceNode {
  const buffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
  const channel = buffer.getChannelData(0);
  for (let i = 0; i < channel.length; i++) channel[i] = Math.sin((i / context.sampleRate) * 2 * Math.PI * 60) * 1e-6;
  const source = context.createBufferSource();
  source.buffer = buffer; source.loop = true;
  source.connect(context.destination);
  source.start();
  return source;
}

/// Queues the tone against the audio clock. Returns false when no sound could be scheduled, so
/// the caller can say so instead of promising an alert that will not arrive.
export function scheduleAlarm(atEpochMs: number): boolean {
  cancelAlarm();
  if (!primeAlarm() || !audio) return false;
  const { context } = audio;
  const delay = (atEpochMs - Date.now()) / 1000;
  if (delay < 0) return false;
  const start = context.currentTime + delay;
  for (const tone of CHIME) scheduled.push(beep(context, start + tone.offset, tone.frequency, tone.duration, tone.gain));
  return true;
}

function beep(context: AudioContext, at: number, frequency: number, duration: number, peakGain: number): OscillatorNode {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.value = frequency;
  // A soft attack/release and two-note interval make a quiet chime instead of an alarm-like burst.
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(peakGain, at + 0.035);
  gain.gain.setValueAtTime(peakGain, at + duration - 0.07);
  gain.gain.linearRampToValueAtTime(0, at + duration);
  oscillator.connect(gain); gain.connect(context.destination);
  oscillator.start(at); oscillator.stop(at + duration + 0.03);
  return oscillator;
}

export function cancelAlarm(): void {
  for (const oscillator of scheduled) { try { oscillator.stop(); oscillator.disconnect(); } catch { /* already finished */ } }
  scheduled = [];
}

/// Released when no rest is running, so the app is not holding an audio session open all day.
export function releaseAlarm(): void {
  cancelAlarm();
  if (!audio) return;
  try { audio.keepAlive.stop(); audio.keepAlive.disconnect(); void audio.context.close(); } catch { /* already closed */ }
  audio = null;
}

/// Plays immediately, for the case where the deadline passed while the tab was frozen and the
/// scheduled tone never got to run.
export function soundNow(): void {
  if (!primeAlarm() || !audio) return;
  const { context } = audio;
  const start = context.currentTime + 0.05;
  for (const tone of CHIME) scheduled.push(beep(context, start + tone.offset, tone.frequency, tone.duration, tone.gain));
}
