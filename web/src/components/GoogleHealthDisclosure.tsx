import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { ShieldCheck, ArrowUpRight } from 'lucide-react';

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
      <div className="google-health-disclosure">
        <p className="disclosure-desc">
          Review how Workout accesses and handles your activity and exercise data.
        </p>

        <div className="disclosure-points" role="list">
          <div className="disclosure-item" role="listitem">
            <strong>Read step counts</strong>
            <p>Workout reads your daily step totals for activity context alongside your training sessions.</p>
          </div>
          <div className="disclosure-item" role="listitem">
            <strong>Workout synchronization</strong>
            <p>Upload completed workout sessions, exercise sets, reps, weight, and volume to Google Health.</p>
          </div>
          <div className="disclosure-item" role="listitem">
            <strong>Persistent across sign-outs</strong>
            <p>Your connection remains linked to your Workout account if you sign out.</p>
          </div>
          <div className="disclosure-item" role="listitem">
            <strong>Complete deletion upon disconnect</strong>
            <p>Disconnecting revokes access and cleans up pending upload records. Workouts already synced remain in Google Health.</p>
          </div>
        </div>

        <div className="disclosure-item google-health-workout-option" style={{ marginTop: '1rem', marginBottom: '1rem' }}>
          <label className="checkbox-row">
            <input
              id="google-health-sync-workout"
              type="checkbox"
              checked={syncWorkout}
              onChange={e => onSyncWorkoutChange(e.target.checked)}
            />
            <span>
              <strong>Sync completed workouts</strong>
              <br />
              <small className="muted">Upload finished workout sessions, sets, volume, and notes to Google Health.</small>
            </span>
          </label>
        </div>

        <div className="disclosure-data-notice" style={{ fontSize: '0.85rem', color: 'var(--muted)', display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
          <ShieldCheck size={18} aria-hidden="true" style={{ flexShrink: 0, marginTop: '2px' }} />
          <p style={{ margin: 0 }}>
            Workout follows the{' '}
            <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer">
              Google API Services User Data Policy <ArrowUpRight size={12} aria-hidden="true" style={{ display: 'inline' }} />
            </a>
            , including Limited Use requirements.
          </p>
        </div>

        {error && (
          <p className="error" role="alert" style={{ color: 'var(--error, #e65050)', marginTop: '0.75rem' }}>
            {error}
          </p>
        )}

        <div className="actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1.25rem' }}>
          <Button variant="tertiary" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button variant="primary" onClick={onConfirm} disabled={loading}>
            {loading ? 'Connecting…' : 'Continue to Google'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
