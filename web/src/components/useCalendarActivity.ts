import { useEffect, useMemo, useRef, useState } from 'react';
import type { WorkoutActivityItem } from '../types';
import { api } from '../lib/api';
import { localDate, weekDays } from '../lib/training';
import { viewReadCache } from '../lib/viewReadCache';

/// How long the calendar must stand still before a week the loaded window does not cover is read.
/// Flicking through weeks asks the server for nothing, so a fast run of swipes stays smooth.
export const CALENDAR_SETTLE_MS = 600;

interface ActivityRead {
  scope: string;
  version: unknown;
  from: string;
  to: string;
  items: WorkoutActivityItem[];
}

/// The week on screen plus the one on either side, so a single swipe lands on data already read.
function activityWindow(offset: number) {
  return { from: localDate(weekDays(offset - 1)[0]), to: localDate(weekDays(offset + 1)[6]) };
}

function cachedRead(scope: string, key: string, from: string, to: string, version: unknown): ActivityRead | null {
  const items = viewReadCache.get<WorkoutActivityItem[]>(key, version);
  return items ? { scope, version, from, to, items } : null;
}

export function useCalendarActivity({ offset, accountId, activeWorkoutId, refreshKey, weekFrom, weekTo }: {
  offset: number;
  accountId: string;
  activeWorkoutId: string | null;
  refreshKey: unknown;
  weekFrom: string;
  weekTo: string;
}) {
  const { from, to } = useMemo(() => activityWindow(offset), [offset]);
  const scope = `${accountId}:${activeWorkoutId ?? ''}`;
  const key = `${accountId}:activity:${from}:${to}:${activeWorkoutId ?? ''}`;
  const [read, setRead] = useState<ActivityRead | null>(() => cachedRead(scope, key, from, to, refreshKey));
  const [error, setError] = useState('');
  const previousOffset = useRef(offset);

  useEffect(() => {
    const moved = previousOffset.current !== offset;
    previousOffset.current = offset;
    const cached = cachedRead(scope, key, from, to, refreshKey);
    setError('');
    if (cached) setRead(cached);
    if (viewReadCache.fresh(key, refreshKey)) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api.activity(from, to, controller.signal)
        .then(items => {
          if (controller.signal.aborted) return;
          viewReadCache.set(key, refreshKey, items);
          setRead({ scope, version: refreshKey, from, to, items });
        })
        .catch(() => {
          if (!controller.signal.aborted) setError('Calendar could not be refreshed.');
        });
    }, moved ? CALENDAR_SETTLE_MS : 0);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [scope, key, from, to, offset, refreshKey]);

  // A week inside the window already read shows at once while the next window waits for the
  // calendar to settle; only a week the read does not cover is unknown.
  const covered = read !== null && read.scope === scope && read.version === refreshKey
    && read.from <= weekFrom && read.to >= weekTo;
  const items = useMemo(() => (read && read.scope === scope ? read.items : []), [read, scope]);
  return { items, loading: !covered, error };
}
