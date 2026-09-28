import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sampleRate = 44100;
const totalDuration = 1.2;
const numSamples = Math.floor(sampleRate * totalDuration);

const CHIME = [
  { frequency: 523.25, offset: 0, duration: 0.65, gain: 0.11 },
  { frequency: 1046.5, offset: 0, duration: 0.28, gain: 0.02 },
  { frequency: 659.25, offset: 0.18, duration: 0.85, gain: 0.12 },
  { frequency: 1318.5, offset: 0.18, duration: 0.32, gain: 0.025 }
];

const samples = new Float32Array(numSamples);

for (let i = 0; i < numSamples; i++) {
  const t = i / sampleRate;
  let sample = 0;

  for (const tone of CHIME) {
    if (t < tone.offset || t > tone.offset + tone.duration) continue;
    const toneT = t - tone.offset;
    let envelope = 0;

    if (toneT <= 0.02) {
      envelope = 0.0001 + (toneT / 0.02) * (tone.gain - 0.0001);
    } else {
      const decayRatio = (toneT - 0.02) / (tone.duration - 0.02);
      envelope = tone.gain * Math.pow(0.0005 / tone.gain, decayRatio);
    }

    sample += envelope * Math.sin(2 * Math.PI * tone.frequency * toneT);
  }

  samples[i] = Math.max(-1, Math.min(1, sample));
}

// Convert to 16-bit PCM
const bytesPerSample = 2;
const dataSize = numSamples * bytesPerSample;
const buffer = Buffer.alloc(44 + dataSize);

// RIFF chunk descriptor
buffer.write('RIFF', 0);
buffer.writeUInt32LE(36 + dataSize, 4);
buffer.write('WAVE', 8);

// fmt sub-chunk
buffer.write('fmt ', 12);
buffer.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
buffer.writeUInt16LE(1, 20);  // AudioFormat (1 for PCM)
buffer.writeUInt16LE(1, 22);  // NumChannels (1 mono)
buffer.writeUInt32LE(sampleRate, 24); // SampleRate
buffer.writeUInt32LE(sampleRate * bytesPerSample, 28); // ByteRate
buffer.writeUInt16LE(bytesPerSample, 32); // BlockAlign
buffer.writeUInt16LE(16, 34); // BitsPerSample

// data sub-chunk
buffer.write('data', 36);
buffer.writeUInt32LE(dataSize, 40);

for (let i = 0; i < numSamples; i++) {
  const s = Math.max(-32768, Math.min(32767, Math.floor(samples[i] * 32767)));
  buffer.writeInt16LE(s, 44 + i * 2);
}

const outDir = path.resolve(__dirname, '../web/android/app/src/main/res/raw');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'rest_chime.wav');
fs.writeFileSync(outFile, buffer);
console.log(`Generated chime asset: ${outFile} (${buffer.length} bytes)`);
