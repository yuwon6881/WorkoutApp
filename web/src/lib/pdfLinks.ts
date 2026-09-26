import { normalizedText, type TextPiece } from './pdfGeometry';

/// A demonstration link a document attaches to the exercise it names.
export type PdfLink = { page: number; name: string; url: string };

/// A rectangle in PDF user space, as a link annotation carries it.
export type LinkRect = { url: string; rect: [number, number, number, number] };

export const MAX_PDF_LINKS = 4000;
const MAX_LINK_NAME = 120;
const MAX_LINK_URL = 400;
/// Only known demonstration and exercise-guide hosts. Recent programs also link an affiliate shop
/// and a journal article from the same annotation layer. A document is untrusted input: what this accepts is a place the
/// app will later offer to send someone, so it stays as narrow as the feature needs.
const VIDEO_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'www.youtu.be',
  'exrx.net', 'www.exrx.net', 'roguefitness.com', 'www.roguefitness.com']);

function isYouTubeVideo(host: string, url: URL): boolean {
  if (host.endsWith('youtu.be')) return /^\/[\w-]+\/?$/.test(url.pathname);
  if (url.pathname === '/watch') return /^[\w-]+$/.test(url.searchParams.get('v') ?? '');
  return /^\/(?:shorts|embed|live|v)\/[\w-]+\/?$/.test(url.pathname);
}

/// Keeps only links this app is willing to open, normalised to https.
export function videoUrl(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_LINK_URL) return undefined;
  let parsed: URL;
  try { parsed = new URL(raw); } catch { return undefined; }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return undefined;
  const host = parsed.hostname.toLowerCase();
  if (!VIDEO_HOSTS.has(host)) return undefined;
  // A channel or search page on a video host is not a demonstration of anything.
  if (host.includes('youtu') && !isYouTubeVideo(host, parsed)) return undefined;
  // The per-share "si" token makes one video look like two; the server drops it too.
  if (host.includes('youtu')) parsed.searchParams.delete('si');
  parsed.protocol = 'https:';
  return parsed.toString();
}

function overlaps(pieceStart: number, pieceEnd: number, rectStart: number, rectEnd: number): boolean {
  return Math.min(pieceEnd, rectEnd) > Math.max(pieceStart, rectStart);
}

function joinedLinkRects(annotations: readonly LinkRect[]): LinkRect[] {
  const groups: LinkRect[] = [];
  const ordered = [...annotations].sort((a, b) =>
    a.url.localeCompare(b.url) || Math.max(b.rect[1], b.rect[3]) - Math.max(a.rect[1], a.rect[3]));
  for (const annotation of ordered) {
    const url = videoUrl(annotation.url);
    if (!url) continue;
    const rect = annotation.rect;
    const left = Math.min(rect[0], rect[2]);
    const right = Math.max(rect[0], rect[2]);
    const bottom = Math.min(rect[1], rect[3]);
    const top = Math.max(rect[1], rect[3]);
    const adjacent = groups.find(group => group.url === url &&
      overlaps(left, right, group.rect[0], group.rect[2]) &&
      bottom <= group.rect[3] + 4 && top >= group.rect[1] - 4);
    if (adjacent) {
      adjacent.rect = [Math.min(left, adjacent.rect[0]), Math.min(bottom, adjacent.rect[1]),
        Math.max(right, adjacent.rect[2]), Math.max(top, adjacent.rect[3])];
    } else {
      groups.push({ url, rect: [left, bottom, right, top] });
    }
  }
  return groups;
}

/// The phrase a link covers, rebuilt from the text under its rectangle. A name wrapped across two
/// baselines — "Machine Chest" above "Press" — sits under one rectangle, so reading order restores
/// it exactly as the cell prints it.
function coveredText(pieces: readonly TextPiece[], rect: LinkRect['rect']): string {
  const [x0, y0, x1, y1] = rect;
  const left = Math.min(x0, x1);
  const right = Math.max(x0, x1);
  const bottom = Math.min(y0, y1);
  const top = Math.max(y0, y1);
  const covered = pieces.filter(piece => {
    const x = piece.transform[4];
    const y = piece.transform[5];
    const width = piece.width ?? 0;
    const height = piece.height ?? 0;
    // The sidebar day label can overlap a link rectangle by a few pixels while its text is
    // centered outside the exercise column. Requiring the glyph run's center to sit under the
    // annotation keeps that label out without dropping wrapped exercise-name lines.
    const centerX = x + width / 2;
    // A baseline sits at the bottom of its glyphs, so the piece is grown upward before testing.
    return centerX >= left && centerX <= right && overlaps(y, y + Math.max(height, 1), bottom, top);
  });
  if (covered.length === 0) return '';
  const ordered = [...covered].sort((a, b) => b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4]);
  return normalizedText(ordered.map(piece => piece.str).join(' '));
}

function glossaryLabel(pieces: readonly TextPiece[], rect: LinkRect['rect']): string | undefined {
  const left = Math.min(rect[0], rect[2]);
  const bottom = Math.min(rect[1], rect[3]);
  const top = Math.max(rect[1], rect[3]);
  const candidates = pieces.filter(piece => {
    const right = piece.transform[4] + (piece.width ?? 0);
    const y = piece.transform[5];
    return right <= left + 2 && left - right < 250 && overlaps(y, y + Math.max(piece.height ?? 0, 1), bottom, top)
      && /:\s*$/.test(piece.str) && !/^https?:/i.test(piece.str);
  }).sort((a, b) => b.transform[4] - a.transform[4]);
  const anchor = candidates[0];
  if (!anchor) return undefined;
  const label = normalizedText(pieces.filter(piece => {
    const x = piece.transform[4];
    const right = x + (piece.width ?? 0);
    return x >= left - 250 && right <= left + 2 && Math.abs(piece.transform[5] - anchor.transform[5]) <= 3
      && !/^https?:/i.test(piece.str);
  }).sort((a, b) => a.transform[4] - b.transform[4]).map(piece => piece.str).join(' '))
    .replace(/:\s*$/, '').replace(/^\d+[.)]\s*/, '').trim();
  return label && label.length <= MAX_LINK_NAME ? label : undefined;
}

/// Pairs each video annotation on a page with the text it is drawn over. Documents that carry no
/// annotations simply produce nothing, which is what makes this skippable rather than conditional.
export function pageLinks(page: number, pieces: readonly TextPiece[], annotations: readonly LinkRect[]): PdfLink[] {
  const seen = new Set<string>();
  const links: PdfLink[] = [];
  for (const annotation of joinedLinkRects(annotations)) {
    const url = annotation.url;
    const covered = coveredText(pieces, annotation.rect);
    // A glossary line can carry one annotation over both its label and the printed address
    // ("Cable flye: https://…"); only the label names the exercise.
    const labelled = covered.replace(/:?\s*https?:\/\/.*$/i, '').trim();
    const name = labelled.length === 0
      ? glossaryLabel(pieces, annotation.rect) ?? ''
      : labelled.slice(0, MAX_LINK_NAME).trim();
    if (name.length === 0) continue;
    const key = `${name.toLowerCase()}${url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ page, name, url });
  }
  return links;
}

/// Earlier guides print exercise references instead of attaching annotations. Only an explicit
/// label beside the URL, or on the immediately preceding line, is strong enough to pair them.
export function printedLinks(page: number, text: string): PdfLink[] {
  const links: PdfLink[] = [];
  let precedingLabel: string | undefined;
  const lines = text.split(/\r?\n/).map(line => line.trim());
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const pair = /^(.{2,120}?):\s*\|?\s*(https?:\/\/\S+)$/i.exec(line);
    const standalone = /^(https?:\/\/\S+)$/i.exec(line);
    const name = pair?.[1]?.trim() ?? (standalone ? precedingLabel : undefined);
    const rawUrl = pair?.[2] ?? standalone?.[1];
    const wrapped = rawUrl ? wrappedUrl(rawUrl, lines.slice(index + 1, index + 3)) : undefined;
    if (wrapped) index += wrapped.lines;
    const url = wrapped?.url ?? videoUrl(rawUrl?.replace(/[.,;)]$/, ''));
    if (name && url && !/^https?:/i.test(name)) links.push({ page, name, url });
    precedingLabel = /^(.{2,120}):$/.exec(line)?.[1]?.trim();
  }
  return links;
}

const YOUTUBE_ID_LENGTH = 11;

function youTubeId(url: string): string | undefined {
  const parsed = new URL(url);
  if (parsed.hostname.endsWith('youtu.be')) return parsed.pathname.slice(1).replace(/\/$/, '');
  return parsed.searchParams.get('v') ?? parsed.pathname.split('/')[2];
}

/// An address that stops short of a demonstration, or whose YouTube id is cut short of its
/// eleven characters, was broken by the line wrap rather than printed that way.
function isCutShort(url: string | undefined): boolean {
  if (!url) return true;
  if (!new URL(url).hostname.includes('youtu')) return false;
  return (youTubeId(url)?.length ?? 0) < YOUTUBE_ID_LENGTH;
}

/// A long address can wrap onto the following printed lines ("…youtube.com/", "watch", "?v=…").
/// Tails are joined only while the address so far is cut short and the next line is nothing but
/// address characters, and only when the joined address is a complete demonstration.
function wrappedUrl(head: string, following: string[]): { url: string; lines: number } | undefined {
  const clean = (value: string) => value.replace(/[.,;)]$/, '');
  let joined = head;
  for (let taken = 0; taken < following.length; taken++) {
    if (!isCutShort(videoUrl(clean(joined)))) break;
    const next = following[taken];
    if (!/^[\w\-?=&.%/#]+$/.test(next) || /^https?:/i.test(next)) break;
    joined += next;
    const url = videoUrl(clean(joined));
    if (url && !isCutShort(url)) return { url, lines: taken + 1 };
  }
  return undefined;
}
