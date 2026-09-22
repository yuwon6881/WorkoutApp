import type { ReactNode } from 'react';

export type ProgressValue = { label: string; detail: string; percent: number | null };

export function Progress({ progress, action }: { progress: ProgressValue; action?: ReactNode }) {
  return (
    <div className="import-progress" role="status" aria-live="polite">
      <div className="import-progress-line">
        <span className="import-progress-label">{progress.label}</span>
        {progress.percent !== null && <span className="import-progress-percent">{progress.percent}%</span>}
      </div>
      <div
        className={`import-progress-track ${progress.percent === null ? 'indeterminate' : ''}`}
        role="progressbar"
        aria-label={progress.label}
        aria-valuenow={progress.percent ?? undefined}
        aria-valuemin={progress.percent === null ? undefined : 0}
        aria-valuemax={progress.percent === null ? undefined : 100}
      >
        <div className="import-progress-fill" style={progress.percent === null ? undefined : { width: `${progress.percent}%` }} />
      </div>
      {(progress.detail || action) && (
        <div className="import-progress-footer">
          {progress.detail && <small>{progress.detail}</small>}
          {action && <div className="import-progress-actions">{action}</div>}
        </div>
      )}
    </div>
  );
}
