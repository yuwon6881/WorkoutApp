import type { ReactNode } from 'react';
import { GymAvailabilityContext } from '../lib/gymAvailability';
import { TrackRirContext, tracksRir } from '../lib/trackRir';
import type { AppState } from './useApp';
import { useGymProfiles } from './useGymProfiles';

/// Account-wide settings every screen reads without threading them through props.
export function AppContexts({ app, children }: { app: AppState; children: ReactNode }) {
  const gyms = useGymProfiles(app);
  return <TrackRirContext value={tracksRir(app.data!.preferences)}>
    <GymAvailabilityContext value={gyms}>{children}</GymAvailabilityContext>
  </TrackRirContext>;
}
