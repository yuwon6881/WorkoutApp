import type { Session } from '../types';

export function workoutServerBaseline(serverSession: Session): { session: Session; revision: number } {
  return { session: serverSession, revision: serverSession.revision };
}

export async function startRestAfterSetIsDurable(
  persist: () => Promise<boolean>,
  start: () => void
): Promise<boolean> {
  const saved = await persist();
  if (saved) start();
  return saved;
}
