/// The arithmetic behind turning an exercise page by dragging it sideways. The page follows the
/// finger; past the first or last exercise it resists, so the edge is felt rather than reached.

export type PageEdges = { canPrevious: boolean; canNext: boolean };
export type PageOutcome = 'previous' | 'next' | 'stay';

/// How far the page moves for a finger that has moved `dx` pixels. Toward a page that does not
/// exist the travel is damped and capped, like a rubber band.
export function pageDragOffset(dx: number, edges: PageEdges): number {
  const blocked = (dx < 0 && !edges.canNext) || (dx > 0 && !edges.canPrevious);
  if (!blocked) return dx;
  const damped = Math.sign(dx) * Math.min(48, Math.abs(dx) * 0.22);
  return damped === 0 ? 0 : damped;
}

/// Whether a released drag turns the page. A long enough drag commits, and so does a quick flick
/// that travelled a little way; anything else, or a drag toward a missing page, springs back.
export function pageSwipeOutcome(dx: number, velocity: number, width: number, edges: PageEdges): PageOutcome {
  const distance = Math.min(96, Math.max(56, width * 0.22));
  const flick = Math.abs(velocity) >= 0.45 && Math.abs(dx) >= 24 && Math.sign(velocity) === Math.sign(dx);
  if (Math.abs(dx) < distance && !flick) return 'stay';
  if (dx < 0) return edges.canNext ? 'next' : 'stay';
  return edges.canPrevious ? 'previous' : 'stay';
}

/// Where an arriving page starts: on the side it comes from, a short way off so it reads as a
/// slide without travelling the whole width.
export function pageEntryOffset(direction: 1 | -1, width: number): number {
  return direction * Math.round(Math.min(120, Math.max(48, width * 0.28)));
}
