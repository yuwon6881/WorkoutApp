import { useEffect, useState } from 'react';
import type { RestState } from '../lib/restTimer';
import { showClock } from '../lib/training';
import { Button } from './ui/Button';

/// The way back into a minimized workout. While a rest is running it counts down here too, so
/// the lifter can browse the app between sets without losing track of the rest.
export function ResumeWorkoutButton({ name, rest, onResume }: { name: string; rest: RestState; onResume: () => void }) {
  const [now, setNow] = useState(Date.now());
  const running = rest.endsAt > now;

  useEffect(() => {
    if (rest.endsAt <= Date.now()) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [rest.endsAt]);

  const remaining = Math.max(0, Math.ceil((rest.endsAt - now) / 1000));
  return (
    <Button className="resume-workout" variant="primary" onClick={onResume}>
      <span className="status-dot" />
      Resume {name}
      {running && <span className="resume-rest" aria-hidden="true">{showClock(remaining)} rest</span>}
    </Button>
  );
}
