import { describe, expect, it } from 'vitest';
import { pageLinks, printedLinks, videoUrl, type LinkRect } from './pdfLinks';
import type { TextPiece } from './pdfGeometry';

function piece(str: string, x: number, y: number, width = str.length * 6, height = 10): TextPiece {
  return { str, transform: [10, 0, 0, 10, x, y], width, height };
}

describe('PDF exercise demo links', () => {
  it('accepts only video hosts and normalises them to https', () => {
    expect(videoUrl('https://youtu.be/qTSTOVVr8rU')).toBe('https://youtu.be/qTSTOVVr8rU');
    expect(videoUrl('http://youtu.be/qTSTOVVr8rU')).toBe('https://youtu.be/qTSTOVVr8rU');
    expect(videoUrl('https://www.youtube.com/watch?v=bEv6CCg2BC8&t=1s'))
      .toBe('https://www.youtube.com/watch?v=bEv6CCg2BC8&t=1s');
    expect(videoUrl('https://exrx.net/WeightExercises/Quadriceps/BBSquat'))
      .toBe('https://exrx.net/WeightExercises/Quadriceps/BBSquat');
    expect(videoUrl('https://www.roguefitness.com/learn/back-squat'))
      .toBe('https://www.roguefitness.com/learn/back-squat');
    // The same annotation layer carries an affiliate shop and a journal article.
    expect(videoUrl('http://bit.ly/jeffmacrofactorworkouts')).toBeUndefined();
    expect(videoUrl('https://journals.lww.com/acsm-msse/fulltext/2011/07000/exercise.aspx')).toBeUndefined();
    expect(videoUrl('javascript:alert(1)')).toBeUndefined();
    expect(videoUrl('https://youtube.com.evil.test/watch?v=1')).toBeUndefined();
    expect(videoUrl(undefined)).toBeUndefined();
  });

  /// Min-Max Phase 2 draws one rectangle over an exercise name that wraps onto a second baseline.
  it('rebuilds a name wrapped across two baselines under one rectangle', () => {
    const pieces = [piece('Machine Chest', 40, 200), piece('Press', 40, 188), piece('2-3', 300, 200)];
    const annotations: LinkRect[] = [{ url: 'https://youtu.be/qTSTOVVr8rU', rect: [38, 184, 140, 212] }];

    expect(pageLinks(26, pieces, annotations)).toEqual([
      { page: 26, name: 'Machine Chest Press', url: 'https://youtu.be/qTSTOVVr8rU' }
    ]);
  });

  it('joins adjacent line links into one complete exercise name', () => {
    const pieces = [
      piece('Seated Super-', 202, 438, 93),
      piece('Bayesian High', 202, 420, 100),
      piece('Cable Curl', 214, 402, 68),
      piece('Next exercise', 202, 320, 100)
    ];
    const url = 'https://youtu.be/example';
    const annotations: LinkRect[] = [
      { url, rect: [201, 416, 300, 433] },
      { url, rect: [203, 315, 303, 332] },
      { url, rect: [202, 434, 295, 451] },
      { url, rect: [214, 398, 283, 415] }
    ];

    expect(pageLinks(6, pieces, annotations)).toEqual([
      { page: 6, name: 'Seated Super- Bayesian High Cable Curl', url },
      { page: 6, name: 'Next exercise', url }
    ]);
  });

  it('does not absorb an overlapping sidebar day label into an exercise link', () => {
    const pieces = [
      piece('Pull #2', 131, 579, 115),
      piece('Cable Rope', 211, 584, 76),
      piece('Hammer Curl', 204, 566, 89)
    ];
    const url = 'https://youtu.be/TTgICSfj1hY?si=yOoxlJpIv6HqFkwW';
    const annotations: LinkRect[] = [
      { url, rect: [204, 579, 292, 596] },
      { url, rect: [204, 562, 292, 578] }
    ];

    expect(pageLinks(50, pieces, annotations)).toEqual([
      { page: 50, name: 'Cable Rope Hammer Curl', url }
    ]);
  });

  it('ignores a rectangle that covers no text and de-duplicates repeated links', () => {
    const pieces = [piece('Pec Deck', 40, 200)];
    const annotations: LinkRect[] = [
      { url: 'https://youtu.be/aaa', rect: [38, 195, 120, 210] },
      { url: 'https://youtu.be/aaa', rect: [38, 195, 120, 210] },
      { url: 'https://youtu.be/bbb', rect: [900, 900, 950, 950] }
    ];

    expect(pageLinks(30, pieces, annotations)).toEqual([
      { page: 30, name: 'Pec Deck', url: 'https://youtu.be/aaa' }
    ]);
  });

  it('pairs a glossary URL with the exercise label immediately to its left', () => {
    const pieces = [
      piece('BACK', 40, 200, 36), piece('SQUAT:', 80, 200, 45), piece('https://youtu.be/aaa', 145, 200, 130),
      piece('BENCH PRESS:', 40, 180, 95), piece('https://youtu.be/bbb', 145, 180, 130)
    ];
    const annotations: LinkRect[] = [
      { url: 'https://youtu.be/aaa', rect: [143, 195, 280, 211] },
      { url: 'https://youtu.be/bbb', rect: [143, 175, 280, 191] }
    ];

    expect(pageLinks(102, pieces, annotations)).toEqual([
      { page: 102, name: 'BACK SQUAT', url: 'https://youtu.be/aaa' },
      { page: 102, name: 'BENCH PRESS', url: 'https://youtu.be/bbb' }
    ]);
  });

  it('does not guess a glossary exercise when the URL has no adjacent label', () => {
    const pieces = [piece('https://youtu.be/aaa', 145, 200, 130), piece('OTHER NOTE', 40, 175, 85)];
    expect(pageLinks(102, pieces, [{ url: 'https://youtu.be/aaa', rect: [143, 195, 280, 211] }])).toEqual([]);
  });

  it('produces nothing for a document with no annotations', () => {
    expect(pageLinks(1, [piece('Back Squat', 40, 200)], [])).toEqual([]);
  });

  it('reads an explicitly paired printed exercise URL without an annotation', () => {
    expect(printedLinks(12, 'BACK SQUAT: https://exrx.net/WeightExercises/Quadriceps/BBSquat\n' +
      'BENCH PRESS:\nhttps://youtu.be/aaa\nUnrelated https://example.com')).toEqual([
      { page: 12, name: 'BACK SQUAT', url: 'https://exrx.net/WeightExercises/Quadriceps/BBSquat' },
      { page: 12, name: 'BENCH PRESS', url: 'https://youtu.be/aaa' }
    ]);
  });
});
