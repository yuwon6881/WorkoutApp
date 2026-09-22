import { normalizedText, type TextPiece } from './pdfGeometry';

/// A demonstration link a document attaches to the exercise it names.
export type PdfLink = { page: number; name: string; url: string };

/// A rectangle in PDF user space, as a link annotation carries it.
export type LinkRect = { url: string; rect: [number, number, number, number] };

export const MAX_PDF_LINKS = 4000;
const MAX_LINK_NAME = 120;
const MAX_LINK_URL = 400;
/// Only video hosts. Recent programs also link an affiliate shop and a journal article from the
/// same annotation layer, and a document is untrusted input: whatever this accepts is a place the
/// app will later offer to send someone, so it stays as narrow as the feature needs.
const VIDEO_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'www.youtu.be']);

/// Keeps only links this app is willing to open, normalised to https.
export function videoUrl(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_LINK_URL) return undefined;
  let parsed: URL;
  try { parsed = new URL(raw); } catch { return undefined; }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return undefined;
  if (!VIDEO_HOSTS.has(parsed.hostname.toLowerCase())) return undefined;
  parsed.protocol = 'https:';
  return parsed.toString();
}

function overlaps(pieceStart: number, pieceEnd: number, rectStart: number, rectEnd: number): boolean {
  return Math.min(pieceEnd, rectEnd) > Math.max(pieceStart, rectStart);
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
    // A baseline sits at the bottom of its glyphs, so the piece is grown upward before testing.
    return overlaps(x, x + width, left, right) && overlaps(y, y + Math.max(height, 1), bottom, top);
  });
  if (covered.length === 0) return '';
  const ordered = [...covered].sort((a, b) => b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4]);
  return normalizedText(ordered.map(piece => piece.str).join(' '));
}

/// Pairs each video annotation on a page with the text it is drawn over. Documents that carry no
/// annotations simply produce nothing, which is what makes this skippable rather than conditional.
export function pageLinks(page: number, pieces: readonly TextPiece[], annotations: readonly LinkRect[]): PdfLink[] {
  const seen = new Set<string>();
  const links: PdfLink[] = [];
  for (const annotation of annotations) {
    const url = videoUrl(annotation.url);
    if (!url) continue;
    const name = coveredText(pieces, annotation.rect).slice(0, MAX_LINK_NAME).trim();
    if (name.length === 0) continue;
    const key = `${name.toLowerCase()}${url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ page, name, url });
  }
  return links;
}
