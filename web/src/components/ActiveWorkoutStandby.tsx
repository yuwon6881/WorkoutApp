import { Dumbbell, FileText, Plus, Zap } from 'lucide-react';
import { Button } from './ui/Button';
import './ActiveWorkoutStandby.css';

interface ActiveWorkoutStandbyProps {
  hasTemplates: boolean;
  onNewWorkout: () => void;
  onImport: () => void;
  onBrowseLibrary: () => void;
}

export function ActiveWorkoutStandby({
  hasTemplates,
  onNewWorkout,
  onImport,
  onBrowseLibrary
}: ActiveWorkoutStandbyProps) {
  return (
    <section className="panel active-workout-standby" aria-label="Session standby status">
      <div className="standby-header">
        <span className="eyebrow standby-eyebrow">
          <span className="status-dot standby-dot" /> Standby · Ready to train
        </span>
      </div>

      <div className="standby-content">
        <div className="standby-icon-wrap" aria-hidden="true">
          <Zap size={22} className="accent" />
        </div>
        <div className="standby-info">
          <h3>Ready for your next workout</h3>
          <p>
            No active workout in progress. Activate a program from your library below,
            or jump straight into a routine to start logging sets.
          </p>
        </div>
      </div>

      <div className="standby-actions">
        {hasTemplates ? (
          <>
            <Button variant="secondary" onClick={onBrowseLibrary}>
              <Dumbbell size={15} /> Browse workout library
            </Button>
            <Button variant="primary" onClick={onNewWorkout}>
              <Plus size={15} /> Build workout
            </Button>
          </>
        ) : (
          <>
            <Button variant="primary" onClick={onNewWorkout}>
              <Plus size={15} /> Build a workout
            </Button>
            <Button variant="secondary" onClick={onImport}>
              <FileText size={15} /> Import a PDF
            </Button>
          </>
        )}
      </div>
    </section>
  );
}
