import { Play } from 'lucide-react';

type Props = { url?: string | null; exerciseName: string };

/// The demonstration video a source document linked from an exercise name. This navigates, so it
/// is an anchor rather than a `Button` — and the anchor belongs to this shared primitive, styled
/// with the same control classes so it sits in an action row like every other action.
///
/// The URL is validated on both sides of the import before it reaches here. It opens in a new tab
/// so a workout in progress is never navigated away from, and severs the opener so the video page
/// cannot reach back into this one.
export function DemoLink({ url, exerciseName }: Props) {
  if (!url) return null;
  return (
    <a
      className="button tertiary exercise-demo-pill"
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={`Watch demonstration of ${exerciseName} (opens in a new tab)`}
      aria-label={`Watch a demonstration of ${exerciseName} (opens in a new tab)`}
    >
      <Play size={12} className="demo-play-icon" aria-hidden="true" fill="currentColor" />
      <span>Demo</span>
    </a>
  );
}
