import { useEffect, useRef, useState } from 'react';
import type { QueueStatus } from '../lib/queue';

// Changes are shown optimistically, so a save the server confirms quickly needs no announcement:
// flashing "Saving…" for a tenth of a second only makes the page look unsettled. A save is
// reported once it is slow enough to notice, and then confirmed briefly; failures, offline and
// sign-out are reported at once because they need the user.
export const SLOW_SAVE_MS = 700;
export const CONFIRM_MS = 1600;

export type SaveIndicator = 'hidden' | 'saving' | 'saved' | 'attention';

const needsAttention = (state: QueueStatus['state']) => state === 'failed' || state === 'offline' || state === 'signed-out';

export function useSaveIndicator(status: QueueStatus): SaveIndicator {
  const [shown, setShown] = useState<SaveIndicator>('hidden');
  const announcedSaving = useRef(false);

  useEffect(() => {
    if (needsAttention(status.state)) {
      announcedSaving.current = false;
      setShown('attention');
      return;
    }
    if (status.state === 'saving' || status.state === 'connecting') {
      const timer = setTimeout(() => { announcedSaving.current = true; setShown('saving'); }, SLOW_SAVE_MS);
      return () => clearTimeout(timer);
    }
    if (status.state === 'saved' && announcedSaving.current) {
      announcedSaving.current = false;
      setShown('saved');
      const timer = setTimeout(() => setShown('hidden'), CONFIRM_MS);
      return () => clearTimeout(timer);
    }
    setShown('hidden');
  }, [status.state]);

  return shown;
}
