import { Button } from './ui/Button';
import { Progress, type ProgressValue } from './ui/Progress';
import { useReducedMotion } from './ui/Motion';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import './ImportProgressPill.css';

/// A floating report that a PDF is being read or has finished, shown on every screen except the import one.
/// It sits where the resume-workout pill sits and steps above it when both are on screen, so the
/// more urgent action keeps the slot nearest the thumb.
export function ImportProgressPill({ progress, finished = false, withResume, onOpen }: {
  progress: ProgressValue;
  finished?: boolean;
  withResume: boolean;
  onOpen: () => void;
}) {
  const reduced = useReducedMotion();
  return (
    <Button
      variant={finished ? 'primary' : 'secondary'}
      className={`import-progress-pill${withResume ? ' has-resume' : ''}${finished ? ' is-finished' : ''}`}
      data-motion-reduced={reduced}
      aria-label={finished ? `${progress.label}: ${progress.detail}. Open the import screen.` : `Import in progress: ${progress.label}. Open the import screen.`}
      onClick={onOpen}
    >
      {finished ? (
        <div className="import-pill-finished">
          <span className="import-pill-icon"><CheckCircle2 size={18} /></span>
          <div className="import-pill-copy">
            <strong>{progress.label}</strong>
            <small>{progress.detail}</small>
          </div>
          <ArrowRight size={16} className="import-pill-arrow" />
        </div>
      ) : (
        <Progress progress={progress} />
      )}
    </Button>
  );
}
