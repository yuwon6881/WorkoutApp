import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { ExerciseLastPerformed } from '../lib/lastPerformed';

/// Each exercise's last top set, for the library's cards. A convenience: until it loads, or if it
/// cannot, the cards simply show no "Last" line. Held in component memory only.
export function useLastPerformed(enabled: boolean): ReadonlyMap<string, ExerciseLastPerformed> {
  const [rows, setRows] = useState<ReadonlyMap<string, ExerciseLastPerformed>>(() => new Map());

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    api.lastPerformed(controller.signal)
      .then(list => { if (!controller.signal.aborted) setRows(new Map(list.map(row => [row.exerciseId, row]))); })
      .catch(() => { /* Optional detail: the cards stay as they were. */ });
    return () => controller.abort();
  }, [enabled]);

  return rows;
}
