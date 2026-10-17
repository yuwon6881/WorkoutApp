import type { ImportStatusView, ImportView } from '../types';
import { estimatedPercent } from './importProgress';

type CachedImportStatus = {
  status: ImportStatusView;
  etag?: string;
  highestPercent: number | null;
  recordedAt: number;
};

const cache = new Map<string, CachedImportStatus>();

export function recordImportStatus(status: ImportStatusView | ImportView, etag?: string | null): void {
  const existing = cache.get(status.id);
  const currentPercent = estimatedPercent(status);
  const highestPercent = Math.max(existing?.highestPercent ?? 0, currentPercent ?? 0);
  cache.set(status.id, {
    status: {
      id: status.id,
      status: status.status,
      stage: status.stage,
      chunksDone: status.chunksDone,
      chunksTotal: status.chunksTotal,
      currentChunkLabel: status.currentChunkLabel,
      error: status.error,
      revision: 'revision' in status && typeof status.revision === 'number' ? status.revision : 0,
      retries: 'retries' in status && typeof status.retries === 'number' ? status.retries : 0,
      unresolvedCount: 'unresolvedCount' in status && typeof status.unresolvedCount === 'number' ? status.unresolvedCount : 0,
      progress: status.progress
    },
    etag: etag !== undefined ? (etag ?? undefined) : existing?.etag,
    highestPercent: highestPercent > 0 ? highestPercent : (currentPercent ?? null),
    recordedAt: Date.now()
  });
}

export function getRecordedImportStatus(id: string): ImportStatusView | undefined {
  return cache.get(id)?.status;
}

export function getRecordedImportEtag(id: string): string | undefined {
  return cache.get(id)?.etag;
}

export function getRecordedHighestPercent(id: string): number | null {
  return cache.get(id)?.highestPercent ?? null;
}

export function clearRecordedImport(id: string): void {
  cache.delete(id);
}
