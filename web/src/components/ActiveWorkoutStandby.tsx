import { FileText, Plus, Zap } from 'lucide-react';
import { Button } from './ui/Button';
import './ActiveWorkoutStandby.css';

interface ActiveWorkoutStandbyProps {
  hasTemplates: boolean;
  onNewWorkout: () => void;
  onImport: () => void;
}

/// Nothing is running. With a library, the library below is the next step, so this is only a
/// status line; with nothing saved yet it offers the two ways to create a first workout.
export function ActiveWorkoutStandby({ hasTemplates, onNewWorkout, onImport }: ActiveWorkoutStandbyProps) {
  if (hasTemplates) {
    return (
      <section className="panel active-workout-standby compact" aria-label="Session standby status">
        <span className="standby-icon-wrap" aria-hidden="true"><Zap size={18} className="accent" /></span>
        <div className="standby-info">
          <h3>No workout in progress</h3>
          <p>Start one from your library below.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="panel active-workout-standby" aria-label="Session standby status">
      <div className="standby-content">
        <span className="standby-icon-wrap" aria-hidden="true"><Zap size={22} className="accent" /></span>
        <div className="standby-info">
          <h3>Ready for your first workout</h3>
          <p>Build one by hand, or import a program from a PDF.</p>
        </div>
      </div>
      <div className="standby-actions">
        <Button variant="secondary" onClick={onImport}>
          <FileText size={15} /> Import a PDF
        </Button>
        <Button variant="primary" onClick={onNewWorkout}>
          <Plus size={15} /> Build a workout
        </Button>
      </div>
    </section>
  );
}
