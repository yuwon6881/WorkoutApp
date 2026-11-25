import { useContext, useState } from 'react';
import { Dumbbell, MapPin } from 'lucide-react';
import { ApiError } from '../lib/api';
import { GymAvailabilityContext } from '../lib/gymAvailability';
import { Select } from './ui/Select';

/// Picks the gym the next workout is done at. Only shown when there is more than one gym; the
/// server refuses a switch while a workout is open, so this lives on the start preview. The quiet
/// variant is a small trailing text control for places where the gym is rarely changed.
export function GymSwitcher({ quiet = false }: { quiet?: boolean }) {
  const { gym, switchGym, switchLocked } = useContext(GymAvailabilityContext);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!gym || !switchGym || switchLocked || gym.profiles.length < 2) return null;
  const change = async (id: string) => {
    if (id === gym.active.id) return;
    setBusy(true);
    setError('');
    try { await switchGym(id); }
    catch (failure) { setError(failure instanceof ApiError ? failure.message : 'The gym could not be switched.'); }
    finally { setBusy(false); }
  };
  return <div className={quiet ? 'gym-switcher gym-switcher-quiet' : 'gym-switcher'}>
    <Select label="Gym" icon={quiet ? <MapPin size={14} aria-hidden="true" /> : <Dumbbell size={14} aria-hidden="true" />}
      value={gym.active.id} disabled={busy} fitMenuToOptions={quiet}
      options={gym.profiles.map(profile => ({ value: profile.id, label: profile.name }))} onChange={id => void change(id)} />
    {error && <p className="error-text" role="alert">{error}</p>}
  </div>;
}
