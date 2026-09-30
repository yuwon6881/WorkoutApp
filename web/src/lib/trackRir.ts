import { createContext, useContext } from 'react';
import type { Preferences } from '../types';

/// Whether reps in reserve is shown and asked for. Hiding it never clears a stored target or a
/// logged value: switching tracking back on shows them unchanged.
export const TrackRirContext = createContext(true);

export const useTrackRir = (): boolean => useContext(TrackRirContext);

/// An older saved copy of the preferences predates the setting, which then keeps its default.
export const tracksRir = (preferences: Pick<Preferences, 'trackRir'>): boolean => preferences.trackRir !== false;
