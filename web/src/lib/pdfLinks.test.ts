import { describe, expect, it } from 'vitest';
import { pageLinks, videoUrl, type LinkRect } from './pdfLinks';
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

  it('produces nothing for a document with no annotations', () => {
    expect(pageLinks(1, [piece('Back Squat', 40, 200)], [])).toEqual([]);
  });
});
