import './LiftLoader.css';

/// The app's one loading animation: three iris bars rising in turn, like reps on a set. Used where
/// a wait has no content to mirror (a workout starting, a program file being checked). Reduced
/// motion keeps the bars still, at staggered heights. The caller owns the status text.
export function LiftLoader({ size = 'md', className = '' }: { size?: 'sm' | 'md'; className?: string }) {
  return (
    <span className={`lift-loader lift-loader-${size} ${className}`.trim()} aria-hidden="true" data-testid="lift-loader">
      <span /><span /><span />
    </span>
  );
}
