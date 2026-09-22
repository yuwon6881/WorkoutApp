import { Button } from './ui/Button';
import { Progress, type ProgressValue } from './ui/Progress';
import { useReducedMotion } from './ui/Motion';

/// A floating report that a PDF is still being read, shown on every screen except the import one.
/// It sits where the resume-workout pill sits and steps above it when both are on screen, so the
/// more urgent action keeps the slot nearest the thumb.
export function ImportProgressPill({ progress, withResume, onOpen }: {
  progress: ProgressValue;
  withResume: boolean;
  onOpen: () => void;
}) {
  const reduced = useReducedMotion();
  return (
    <Button
      variant="secondary"
      className={`import-progress-pill${withResume ? ' has-resume' : ''}`}
      data-motion-reduced={reduced}
      aria-label={`Import in progress: ${progress.label}. Open the import screen.`}
      onClick={onOpen}
    >
      <Progress progress={progress} />
    </Button>
  );
}
