import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { SettingRow } from './ui/SettingRow';
import { Switch } from './ui/Switch';
import { ShieldCheck, ArrowUpRight } from 'lucide-react';
import './GoogleHealthDisclosure.css';

interface GoogleHealthDisclosureProps {
  onClose: () => void;
  onConfirm: () => void;
  syncWorkout: boolean;
  onSyncWorkoutChange: (checked: boolean) => void;
  loading?: boolean;
  error?: string;
}

export function GoogleHealthDisclosure({
  onClose,
  onConfirm,
  syncWorkout,
  onSyncWorkoutChange,
  loading = false,
  error,
}: GoogleHealthDisclosureProps) {
  return (
    <Modal title="Connect Google Health" onClose={onClose} wide={false}>
      <div className="modal-body google-health-disclosure">
        <p className="muted">Review how Workout accesses and handles your activity and exercise data.</p>

        <ul className="disclosure-points">
          <li>
            <strong>Read step counts</strong>
            <p>Workout reads your daily step totals for activity context alongside your training sessions.</p>
          </li>
          <li>
            <strong>Workout synchronization</strong>
            <p>Upload completed workout sessions, exercise sets, reps, weight, and volume to Google Health.</p>
          </li>
          <li>
            <strong>Persistent across sign-outs</strong>
            <p>Your connection remains linked to your Workout account if you sign out.</p>
          </li>
          <li>
            <strong>Complete deletion upon disconnect</strong>
            <p>Disconnecting revokes access and cleans up pending upload records. Workouts already synced remain in Google Health.</p>
          </li>
        </ul>

        <SettingRow
          className="disclosure-option"
          label={<strong>Sync completed workouts</strong>}
          description="Upload finished workout sessions, sets, volume, and notes to Google Health."
          descriptionId="google-health-sync-workout-description"
        >
          <Switch
            label="Sync completed workouts"
            describedBy="google-health-sync-workout-description"
            checked={syncWorkout}
            onChange={onSyncWorkoutChange}
          />
        </SettingRow>

        <p className="disclosure-data-notice">
          <ShieldCheck size={18} aria-hidden="true" />
          <span>
            Workout follows the{' '}
            <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer">
              Google API Services User Data Policy <ArrowUpRight size={12} aria-hidden="true" />
            </a>
            , including Limited Use requirements.
          </span>
        </p>

        {error && <p className="error-text" role="alert">{error}</p>}
      </div>
      <div className="modal-actions">
        <Button variant="tertiary" onClick={onClose} disabled={loading}>
          Cancel
        </Button>
        <Button variant="primary" onClick={onConfirm} disabled={loading}>
          {loading ? 'Connecting…' : 'Continue to Google'}
        </Button>
      </div>
    </Modal>
  );
}
