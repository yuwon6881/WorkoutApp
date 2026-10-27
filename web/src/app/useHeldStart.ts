import { useEffect, useRef, useState } from 'react';

/// What a Start tap asked for while the screen showed only the device copy of the launch summary.
export type HeldStart =
  | { kind: 'dock' }
  /** `wasNext`: the tapped plan was the next workout the device remembered. */
  | { kind: 'preview'; templateId: string; wasNext: boolean };

/**
 * A cold start shows the launch summary remembered on this device until the server answers. A Start
 * tapped in that moment is held and carried out once the server has confirmed the account, against
 * the next workout it reports, so the preview never opens a plan that has since changed. A failed
 * read drops the device copy (and with it the held tap) for the connection recovery screen.
 */
export function useHeldStart(unconfirmed: boolean, hasData: boolean) {
  const [held, setHeld] = useState<HeldStart | null>(null);
  /// Set on every render after the start actions are defined, so a release uses the confirmed data.
  const release = useRef<((held: HeldStart) => void) | null>(null);

  useEffect(() => {
    if (unconfirmed || !held) return;
    setHeld(null);
    if (hasData) release.current?.(held);
  }, [unconfirmed, held, hasData]);

  return { hold: setHeld, release };
}
