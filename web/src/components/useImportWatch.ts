import { useEffect, useRef, useState } from 'react';
import type { ImportStatusView, ImportView } from '../types';
import { api } from '../lib/api';
import type { ProgressValue } from './ui/Progress';

const POLL_INTERVAL_MS = 2_000;
const STALL_INTERVAL_MS = 90_000;

export type ImportWatch = { importId: string; progress: ProgressValue } | null;

/// An import is a server-owned background job: the runner keeps reading after the import screen is
/// closed. Without this the only client that knows a read is happening is that screen, so leaving
/// it makes an import in progress look like nothing at all.
///
/// This is deliberately a watcher rather than a lift of `useImportPipeline`. It reports progress
/// and keeps the stall kick alive; it never applies a draft or decides an import is finished. The
/// import screen remains the one place that owns the read, and this stands down whenever that
/// screen is open so the two never poll the same row at once.
export function useImportWatch({ imports, active, onFinished }: {
  imports: ImportView[];
  /// False while the import screen is mounted, since it does its own polling and shows its own bar.
  active: boolean;
  onFinished: () => void;
}): ImportWatch {
  const [watch, setWatch] = useState<ImportWatch>(null);
  const finished = useRef(onFinished);
  finished.current = onFinished;

  /// The row worth following is one the server is actively reading. `select` is a question waiting
  /// on the user, not work in flight, so it belongs on the import screen rather than in a pill.
  const running = imports.find(view => view.status === 'pending' && view.stage !== 'select' && !view.error);
  const importId = active ? running?.id ?? null : null;
  const initialStage = running?.stage ?? 'outline';
  const initialDone = running?.chunksDone ?? 0;
  const initialTotal = running?.chunksTotal ?? 0;
  const fileName = running?.fileName ?? '';

  useEffect(() => {
    if (!importId) { setWatch(null); return; }

    let stopped = false;
    let etag: string | undefined;
    let lastStage: string = initialStage;
    let lastDone = initialDone;
    let lastProgressAt = Date.now();

    const show = (stage: string, done: number, total: number, label: string | null) => {
      const remaining = Math.max(0, total - done);
      setWatch({
        importId,
        progress: {
          label: stage === 'outline'
            ? 'Reading the outline'
            : remaining > 1 ? `Reading ${remaining} sections` : 'Reading the last section',
          detail: remaining > 1 ? fileName : label ?? fileName,
          percent: total > 0 ? Math.round((done / total) * 100) : null
        }
      });
    };

    show(initialStage, initialDone, initialTotal, null);

    void (async () => {
      while (!stopped) {
        await new Promise(resolve => window.setTimeout(resolve, POLL_INTERVAL_MS));
        if (stopped) return;

        let status: ImportStatusView;
        try {
          const meta = await api.getImportStatusMeta(importId, etag);
          if (meta.etag) etag = meta.etag;
          if (meta.notModified || !meta.data) {
            // An unchanged row is still a reason to consider the pass stalled.
            if (Date.now() - lastProgressAt >= STALL_INTERVAL_MS) {
              try { await api.extractImport(importId); } catch { /* the next poll reports the state */ }
              lastProgressAt = Date.now();
            }
            continue;
          }
          status = meta.data;
        } catch {
          // A failed poll is not worth surfacing from a background pill; the import screen reports
          // properly when it is opened. Keep the last figures and try again.
          continue;
        }
        if (stopped) return;

        if (status.status !== 'pending' || status.stage === 'select' || status.error) {
          setWatch(null);
          finished.current();
          return;
        }

        show(status.stage, status.chunksDone, status.chunksTotal, status.currentChunkLabel);

        if (status.stage !== lastStage || status.chunksDone > lastDone) {
          lastStage = status.stage;
          lastDone = status.chunksDone;
          lastProgressAt = Date.now();
        } else if (Date.now() - lastProgressAt >= STALL_INTERVAL_MS) {
          // A scale-to-zero instance that recycled has no in-memory pass left. Kicking again is
          // safe while the original is alive because ImportRunner coalesces the duplicate. The
          // import screen does this too; away from it, nothing else would.
          try { await api.extractImport(importId); } catch { /* the next poll reports the state */ }
          lastProgressAt = Date.now();
        }
      }
    })();

    return () => { stopped = true; };
    // The initial figures only seed the first paint; re-running on each of their changes would
    // restart the loop every poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importId, fileName]);

  return watch;
}
