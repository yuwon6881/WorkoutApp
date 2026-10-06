import { describe, expect, it } from 'vitest';
import { getVideoEmbedInfo } from './videoEmbed';

describe('getVideoEmbedInfo', () => {
  it('parses youtu.be short links into embed player URLs', () => {
    const result = getVideoEmbedInfo('https://youtu.be/SJqInYJcd6c');
    expect(result.platform).toBe('youtube');
    expect(result.embedUrl).toContain('https://www.youtube-nocookie.com/embed/SJqInYJcd6c');
    expect(result.embedUrl).toContain('playsinline=1');
  });

  it('parses standard youtube watch links with timestamps', () => {
    const result = getVideoEmbedInfo('https://www.youtube.com/watch?v=SJqInYJcd6c&t=45s');
    expect(result.platform).toBe('youtube');
    expect(result.embedUrl).toContain('https://www.youtube-nocookie.com/embed/SJqInYJcd6c');
    expect(result.embedUrl).toContain('start=45');
  });

  it('parses compound minute-second timestamps', () => {
    const result = getVideoEmbedInfo('https://youtu.be/SJqInYJcd6c?t=1m20s');
    expect(result.platform).toBe('youtube');
    expect(result.embedUrl).toContain('start=80');
  });

  it('parses youtube shorts and embed links', () => {
    const shortsResult = getVideoEmbedInfo('https://youtube.com/shorts/SJqInYJcd6c');
    expect(shortsResult.platform).toBe('youtube');
    expect(shortsResult.embedUrl).toContain('/embed/SJqInYJcd6c');

    const embedResult = getVideoEmbedInfo('https://www.youtube.com/embed/SJqInYJcd6c');
    expect(embedResult.platform).toBe('youtube');
    expect(embedResult.embedUrl).toContain('/embed/SJqInYJcd6c');
  });

  it('parses vimeo links', () => {
    const result = getVideoEmbedInfo('https://vimeo.com/76979871');
    expect(result.platform).toBe('vimeo');
    expect(result.embedUrl).toBe('https://player.vimeo.com/video/76979871?autoplay=1');
  });

  it('returns other platform and null embed for non-video hosts', () => {
    const result = getVideoEmbedInfo('https://exrx.net/WeightExercises/DeltoidLateral/CBLateralRaise');
    expect(result.platform).toBe('other');
    expect(result.embedUrl).toBeNull();
  });

  it('handles null, undefined, and invalid URLs safely', () => {
    expect(getVideoEmbedInfo(null).embedUrl).toBeNull();
    expect(getVideoEmbedInfo(undefined).embedUrl).toBeNull();
    expect(getVideoEmbedInfo('not-a-url').embedUrl).toBeNull();
  });
});
