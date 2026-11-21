import { useContext, useEffect, useMemo, useState } from 'react';
import type { DraftWorkout, Exercise, Unit } from '../types';
import { api } from '../lib/api';
import { GymAvailabilityContext } from '../lib/gymAvailability';
import { previewLoadsByLine, type StartPreviewExercise } from '../lib/startPreviewLoads';

type LoadedPreview = {
  templateId: string;
  gymId: string | null;
  requestId: number;
  exercises: StartPreviewExercise[];
};

/// Loads the server's planned weights for either read-only start preview, without retaining results
/// across a different day, gym, or later opening of the same day.
export function useStartPreviewLoads(templateId: string | null, day: DraftWorkout | null, exercises: Exercise[], unit: Unit,
  requestId = 0): ReadonlyMap<string, readonly (string | null | undefined)[]> | undefined {
  const { gym } = useContext(GymAvailabilityContext);
  const gymId = gym?.active.id ?? null;
  const [loaded, setLoaded] = useState<LoadedPreview | null>(null);

  useEffect(() => {
    if (!templateId) return;
    const controller = new AbortController();
    api.startPreview(templateId, controller.signal).then(preview => {
      if (!controller.signal.aborted) setLoaded({ templateId, gymId, requestId, exercises: preview });
    }).catch(() => undefined);
    return () => controller.abort();
  }, [templateId, gymId, requestId]);

  return useMemo(() => {
    if (!templateId || !day || !loaded || loaded.templateId !== templateId || loaded.gymId !== gymId || loaded.requestId !== requestId)
      return undefined;
    const catalogById = new Map(exercises.map(exercise => [exercise.id, exercise]));
    const catalogByName = new Map(exercises.map(exercise => [exercise.name.toLowerCase().trim(), exercise]));
    const byLine = new Map(day.exercises.map(exercise => [exercise.lineId,
      (exercise.exerciseId ? catalogById.get(exercise.exerciseId) : undefined) ?? catalogByName.get(exercise.sourceName.toLowerCase().trim())]));
    return previewLoadsByLine(loaded.exercises, byLine, unit);
  }, [templateId, day, loaded, gymId, requestId, exercises, unit]);
}