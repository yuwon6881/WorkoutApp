import type { TextPiece } from './pdfGeometry';

export function horizontalPiece(text: string, x: number, y: number, width = text.length * 5, scale = 10): TextPiece {
  return { str: text, transform: [scale, 0, 0, scale, x, y], width, height: scale };
}

export function rotatedPiece(
  text: string,
  x: number,
  y: number,
  width = text.length * 5,
  scale = 10,
  direction: 'cw' | 'ccw' = 'cw'
): TextPiece {
  return direction === 'cw'
    ? { str: text, transform: [0, scale, -scale, 0, x, y], width, height: scale }
    : { str: text, transform: [0, -scale, scale, 0, x, y], width, height: scale };
}

export function trackingPage(scale = 1, sets = 2, effort: 'rir' | 'setRir' | 'rpe' | 'splitRpe' = 'rir'): TextPiece[] {
  const p = (text: string, x: number, y: number, width = text.length * 5) => horizontalPiece(text, x * scale, y * scale, width * scale, 10 * scale);
  const effortStart = 650 + sets * 110;
  const effortStep = 48;
  const effortSpan = effort === 'rpe' || effort === 'splitRpe' ? 160 : sets * effortStep;
  const rest = Math.max(1100, effortStart + effortSpan + 40);
  const option1 = rest + 95;
  const option2 = rest + 260;
  const notes = rest + 460;
  const pieces: TextPiece[] = [p('Tracking Load and Reps', effortStart - 180, 1000, 180), p('Failure?', effortStart + 20, 1000, 55)];
  pieces.push(p('Exercise', 100, 985, 50), p('Last-Set Intensity', 250, 985, 140), p('Technique', 315, 968, 65));
  pieces.push(p('Warm-up', 420, 985, 60), p('Sets', 445, 968, 25), p('WORKING', 520, 985, 62), p('SETS', 540, 968, 26));
  pieces.push(p('Rep', 570, 985, 28), p('Range', 560, 968, 30));
  for (let set = 1; set <= sets; set++) {
    const x = 650 + (set - 1) * 110;
    pieces.push(p(`SET ${set}`, x, 978, 38), p('LOAD', x, 950, 28), p('REPS', x + 30, 950, 28));
  }
  if (effort === 'rpe') {
    pieces.push(p('Early Set RPE', effortStart, 978, 90), p('Last Set RPE', effortStart + 100, 978, 85));
  } else if (effort === 'splitRpe') {
    pieces.push(p('Early Set', effortStart, 978, 50), p('RPE', effortStart + 12, 956, 25));
    pieces.push(p('Last Set', effortStart + 100, 978, 45), p('RPE', effortStart + 108, 956, 25));
  } else if (effort === 'setRir') {
    for (let set = 1; set <= sets; set++) pieces.push(p(`SET ${set} RIR`, effortStart + (set - 1) * effortStep, 978, 50));
  } else {
    for (let set = 1; set <= sets; set++) {
      const x = effortStart + (set - 1) * effortStep;
      pieces.push(p('RIR', x + 7, 978, 23), p(`(Set ${set})`, x, 956, 40));
    }
  }
  pieces.push(p('Rest', rest, 985, 30), p('Substitution', option1 - 15, 985, 100), p('Option 1', option1, 968, 60));
  pieces.push(p('Substitution', option2 - 15, 985, 100), p('Option 2', option2, 968, 60), p('NOTES', notes, 985, 45));
  pieces.push(p('Chest Press', 100, 900, 100), p('2-3', 440, 900, 25), p('2', 540, 900, 10), p('6-8', 560, 900, 30));
  for (let set = 1; set <= sets; set++) {
    const x = 650 + (set - 1) * 110;
    pieces.push(p('100', x, 900, 25), p('8', x + 30, 900, 10));
  }
  if (effort === 'rpe' || effort === 'splitRpe') {
    pieces.push(p('7-8', effortStart, 900, 25), p('9', effortStart + 100, 900, 10));
  } else {
    for (let set = 1; set <= sets; set++) pieces.push(p('2', effortStart + (set - 1) * effortStep + 7, 900, 10));
  }
  pieces.push(p('2 min', rest, 900, 35), p('DB Press', option1 - 15, 900, 60), p('Machine Press', option2 - 15, 900, 75), p('Controlled reps', notes, 900, 80));
  return pieces;
}
