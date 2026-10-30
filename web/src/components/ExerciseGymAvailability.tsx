import { useContext, useState } from 'react';
import type { GymExerciseOverride } from '../types';
import { api, ApiError } from '../lib/api';
import { GymAvailabilityContext, gymAvailability } from '../lib/gymAvailability';
import { SegmentedControl } from './ui/SegmentedControl';
import { SettingRow } from './ui/SettingRow';

type Choice = 'equipment' | GymExerciseOverride;

/// Settles one exercise at the active gym when the equipment list does not tell the whole story:
/// a machine the list lacks but this gym has, or one it lists that is broken or always taken.
export function ExerciseGymAvailability({ exerciseId, requires }: { exerciseId: string; requires?: readonly string[] }) {
  const { gym, apply } = useContext(GymAvailabilityContext);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!gym || !apply) return null;
  const profile = gym.active;
  const choice: Choice = profile.exerciseOverrides[exerciseId] ?? 'equipment';
  const byEquipment = gymAvailability({ ...gym, active: { ...profile, exerciseOverrides: {} } }, exerciseId, requires);
  const description = (byEquipment.available
    ? `${profile.name} has the equipment this needs.`
    : `${profile.name} has no ${byEquipment.missing.join(', ')}.`) + ' Auto follows its equipment list.';

  async function choose(next: Choice) {
    if (next === choice) return;
    const { [exerciseId]: _previous, ...rest } = profile.exerciseOverrides;
    setBusy(true);
    setError('');
    try {
      await apply!(await api.updateGym(profile.id, { name: profile.name, missingEquipment: profile.missingEquipment,
        exerciseOverrides: next === 'equipment' ? rest : { ...rest, [exerciseId]: next }, revision: profile.revision }));
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'This choice was not saved. Please retry.');
      // The gym changed elsewhere: take its current revision so the next choice can save.
      if (failure instanceof ApiError && failure.conflict) {
        try { await apply!(await api.gyms()); } catch { /* the message already says to retry */ }
      }
    } finally { setBusy(false); }
  }

  return <>
    <SettingRow className="setting-row-stacked" label={<strong>At {profile.name}</strong>} description={description}
      descriptionId={`gym-availability-${exerciseId}`}>
      <SegmentedControl label={`Availability at ${profile.name}`} value={choice} disabled={busy} onChange={next => void choose(next)}
        options={[
          { value: 'equipment', label: 'Auto', ariaLabel: 'Follow the equipment list' },
          { value: 'available', label: 'Available' },
          { value: 'unavailable', label: 'Unavailable' }
        ]} />
    </SettingRow>
    {error && <p className="error-text" role="alert">{error}</p>}
  </>;
}
