function parseStartTime(raw: string | null): number | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const digitMatch = /^(\d+)s?$/i.exec(trimmed);
  if (digitMatch) {
    const val = Number.parseInt(digitMatch[1], 10);
    return Number.isFinite(val) && val > 0 ? val : null;
  }
  let total = 0;
  let matched = false;
  const hours = /(\d+)\s*h/i.exec(trimmed);
  if (hours) { total += Number.parseInt(hours[1], 10) * 3600; matched = true; }
  const mins = /(\d+)\s*m/i.exec(trimmed);
  if (mins) { total += Number.parseInt(mins[1], 10) * 60; matched = true; }
  const secs = /(\d+)\s*s/i.exec(trimmed);
  if (secs) { total += Number.parseInt(secs[1], 10); matched = true; }
  return matched && total > 0 ? total : null;
}

export type VideoEmbedInfo = {
  embedUrl: string | null;
  platform: 'youtube' | 'vimeo' | 'other';
};

/// Parses video demonstration links (e.g. YouTube, YouTube Shorts, Vimeo) into embedded
/// player URLs so demonstrations can play directly inside an in-app modal rather than
/// forcing navigation to a new tab or launching the YouTube app on mobile.
export function getVideoEmbedInfo(rawUrl: string | null | undefined): VideoEmbedInfo {
  if (!rawUrl) return { embedUrl: null, platform: 'other' };
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase();

    if (host.includes('youtu.be') || host.includes('youtube.com')) {
      let videoId: string | null = null;
      if (host.includes('youtu.be')) {
        const pathPart = parsed.pathname.replace(/^\/+/, '').split('/')[0];
        videoId = pathPart || null;
      } else if (parsed.pathname === '/watch') {
        videoId = parsed.searchParams.get('v');
      } else if (parsed.pathname.startsWith('/shorts/') || parsed.pathname.startsWith('/embed/')) {
        const parts = parsed.pathname.split('/');
        videoId = parts[2] || null;
      }

      if (videoId && /^[\w-]+$/.test(videoId)) {
        const start = parseStartTime(parsed.searchParams.get('t') ?? parsed.searchParams.get('start'));
        const params = new URLSearchParams({
          autoplay: '1',
          rel: '0',
          modestbranding: '1',
          playsinline: '1'
        });
        if (start !== null) params.set('start', String(start));
        return {
          embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}?${params.toString()}`,
          platform: 'youtube'
        };
      }
    }

    if (host.includes('vimeo.com')) {
      const match = /\/(\d+)/.exec(parsed.pathname);
      if (match) {
        return {
          embedUrl: `https://player.vimeo.com/video/${match[1]}?autoplay=1`,
          platform: 'vimeo'
        };
      }
    }

    return { embedUrl: null, platform: 'other' };
  } catch {
    return { embedUrl: null, platform: 'other' };
  }
}
