import type { ReactNode } from 'react';
import { GymAvailabilityContext } from '../lib/gymAvailability';
import { TrackRirContext, tracksRir } from '../lib/trackRir';
import type { AppState } from './useApp';
import { useGymProfiles } from './useGymProfiles';
import { ViewReadScopeContext } from '../lib/viewReadScope';

/// Account-wide settings every screen reads without threading them through props.
export function AppContexts({ app, children }: { app: AppState; children: ReactNode }) {
  const gyms = useGymProfiles(app);
  const scope = JSON.stringify([app.data?.account.id, app.data?.resourceVersions]);
  return <TrackRirContext value={tracksRir(app.data!.preferences)}>
    <ViewReadScopeContext value={scope}>
      <GymAvailabilityContext value={gyms}>{children}</GymAvailabilityContext>
    </ViewReadScopeContext>
  </TrackRirContext>;
}
