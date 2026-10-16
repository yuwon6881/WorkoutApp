import { useEffect, useState } from 'react';
import type { ImportProgressEstimate } from '../lib/importProgress';

/// How quickly the bar closes the gap to the next milestone while a read is out: about two thirds
/// of the way in this long, which is a typical section read.
const CREEP_MS = 25_000;

function useSecondTick(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

type Anchor = { key: string | null; at: number; floor: number; estimate: ImportProgressEstimate | null };

function creep(estimate: ImportProgressEstimate, anchor: Anchor, now: number): number {
  const base = Math.max(anchor.floor, estimate.percent);
  const ceiling = Math.max(base, estimate.ceiling);
  return base + (ceiling - base) * (1 - Math.exp(-Math.max(0, now - anchor.at) / CREEP_MS));
}

/// The server reports a section only when its state changes, which can be half a minute apart.
/// Between reports the bar keeps easing toward the furthest point the sections could have reached,
/// never past it and never backwards, so a long read looks like work rather than a stall.
export function useLiveImportPercent(estimate: ImportProgressEstimate | null, startedAtUtc: string | null | undefined) {
  const now = useSecondTick(estimate !== null || Boolean(startedAtUtc));
  const key = estimate ? `${estimate.percent}/${estimate.ceiling}` : null;
  const [anchor, setAnchor] = useState<Anchor>({ key, at: now, floor: estimate?.percent ?? 0, estimate });
  let current = anchor;
  if (anchor.key !== key) {
    // A new report starts a new ease from wherever the bar already is; a repair that lowers the
    // estimate holds the bar still rather than moving it back.
    const shown = estimate && anchor.estimate ? creep(anchor.estimate, anchor, now) : 0;
    current = { key, at: now, floor: Math.max(estimate?.percent ?? 0, shown), estimate };
    setAnchor(current);
  }
  const percent = estimate ? Math.min(99, Math.floor(creep(estimate, current, now))) : null;
  const started = startedAtUtc ? Date.parse(startedAtUtc) : Number.NaN;
  const elapsedSeconds = Number.isFinite(started) ? Math.max(0, Math.floor((now - started) / 1000)) : null;
  return { percent, elapsedSeconds };
}

export function formatElapsed(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}
