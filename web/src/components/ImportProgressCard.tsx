import { Check, Trash2, X } from 'lucide-react';
import type { ImportProgressDetails, ImportView } from '../types';
import type { ImportProgress } from './useImportPipeline';
import { Button } from './ui/Button';
import { useReducedMotion } from './ui/Motion';
import './ImportProgressCard.css';

/// What the import is doing. A read in flight covers every section the import still owes, because
/// they are sent together rather than one after another, so it says how many are being read; a
/// resting import names the section that commits next instead.
function stageLabel(view: ImportView, reading = false) {
  if (view.stage === 'outline') return 'Reading the outline';
  if (view.stage === 'select') return 'Waiting for your choice';
  if ((view.progress?.sectionsRepairing ?? 0) > 0) return `Repairing ${view.progress!.sectionsRepairing} section${view.progress!.sectionsRepairing === 1 ? '' : 's'}`;
  if ((view.progress?.sectionsVerifying ?? 0) > 0) return `Checking ${view.progress!.sectionsVerifying} section${view.progress!.sectionsVerifying === 1 ? '' : 's'} against the PDF`;
  if (view.stage === 'verify') return 'Checking extracted details against the PDF';
  if (view.stage === 'recover') return 'Repairing source discrepancies';
  if (view.stage !== 'extract') return 'Reading';
  const remaining = Math.max(0, view.chunksTotal - view.chunksDone);
  if (!reading) return `Section ${Math.min(view.chunksDone + 1, view.chunksTotal)} of ${view.chunksTotal}`;
  return remaining > 1 ? `Reading ${remaining} sections at once` : 'Reading the last section';
}

type StepperStage = {
  key: string;
  label: string;
};

const STAGES: readonly StepperStage[] = [
  { key: 'outline', label: 'Outline' },
  { key: 'reading', label: 'Reading sections' },
  { key: 'checking', label: 'Checking' },
  { key: 'ready', label: 'Ready' },
] as const;

/// Derives the 0-indexed stage step from the server-reported pipeline stage.
function getStageIndex(stage: ImportView['stage']): number {
  switch (stage) {
    case 'outline':
      return 0;
    case 'select':
      return 0;
    case 'extract':
      return 1;
    case 'verify':
    case 'recover':
      return 2;
    case 'done':
      return 3;
    default:
      return 0;
  }
}

type StatChip = {
  id: string;
  count: number;
  label: string;
  tone: 'accent' | 'default' | 'blue' | 'amber' | 'red';
};

/// Converts granular section progress counters into concise chips for display in verify/recover stages.
/// The committed count is always retained (even at zero); other metrics hide when zero.
function getStatChips(progress: ImportProgressDetails, chunksDone: number): StatChip[] {
  const committed = progress.sectionsCompleted ?? chunksDone ?? 0;
  const saved = progress.sectionsWithResponses ?? 0;
  const queued = progress.sectionsQueued ?? 0;
  const reading = progress.sectionsReading ?? 0;
  const checking = progress.sectionsVerifying ?? 0;
  const repairing = progress.sectionsRepairing ?? 0;

  const chips: StatChip[] = [
    { id: 'committed', count: committed, label: 'committed', tone: 'accent' },
  ];

  if (saved > 0) chips.push({ id: 'saved', count: saved, label: 'saved', tone: 'default' });
  if (queued > 0) chips.push({ id: 'queued', count: queued, label: 'queued', tone: 'default' });
  if (reading > 0) chips.push({ id: 'reading', count: reading, label: 'reading', tone: 'blue' });
  if (checking > 0) chips.push({ id: 'checking', count: checking, label: 'checking', tone: 'amber' });
  if (repairing > 0) chips.push({ id: 'repairing', count: repairing, label: 'repairing', tone: 'red' });

  return chips;
}

/// Unified progress card for the import: PDF page reading on this device, program detection, and
/// server-side section extraction share one consistent card with stage stepper, rounded track, and stat chips.
export function ImportProgressCard({ uploadProgress, selected, busy, onCancelUpload, onDiscard }: {
  uploadProgress: ImportProgress | null;
  selected: ImportView | null;
  busy: boolean;
  onCancelUpload: () => void;
  onDiscard: (view: ImportView) => void;
}) {
  const reduced = useReducedMotion();

  // On-device PDF page reading stage
  if (uploadProgress) {
    const action = uploadProgress.label === 'Reading the PDF on this device' ? (
      <Button variant="secondary" onClick={onCancelUpload} className="ipc-action-btn">
        <X size={15} />Cancel PDF reading
      </Button>
    ) : undefined;

    return (
      <div
        className="ipc-card import-progress"
        role="status"
        aria-live="polite"
        data-motion-reduced={reduced || undefined}
      >
        <div className="ipc-status-line import-progress-line">
          <span className="ipc-status-label import-progress-label">{uploadProgress.label}</span>
          {uploadProgress.percent !== null && (
            <span className="ipc-status-percent import-progress-percent">{uploadProgress.percent}%</span>
          )}
        </div>
        <div
          className={`ipc-progress-track import-progress-track ${uploadProgress.percent === null ? 'indeterminate' : ''}`}
          role="progressbar"
          aria-label={uploadProgress.label}
          aria-valuenow={uploadProgress.percent ?? undefined}
          aria-valuemin={uploadProgress.percent === null ? undefined : 0}
          aria-valuemax={uploadProgress.percent === null ? undefined : 100}
        >
          <div
            className="ipc-progress-fill import-progress-fill"
            style={uploadProgress.percent === null ? undefined : { width: `${uploadProgress.percent}%` }}
          />
        </div>
        {(uploadProgress.detail || action) && (
          <div className="ipc-footer import-progress-footer">
            <div className="ipc-footer-info">
              {uploadProgress.detail && <p className="ipc-detail-text">{uploadProgress.detail}</p>}
            </div>
            {action && <div className="ipc-actions import-progress-actions">{action}</div>}
          </div>
        )}
      </div>
    );
  }

  // Server-side import stages
  if (!selected || selected.status !== 'pending' || selected.stage === 'select') return null;

  const isChecking = selected.stage === 'verify' || selected.stage === 'recover';
  const label = stageLabel(selected, busy);
  const percent = isChecking
    ? null
    : selected.chunksTotal > 0
      ? Math.min(99, Math.round((selected.chunksDone / selected.chunksTotal) * 100))
      : null;

  const statChips = isChecking && selected.progress
    ? getStatChips(selected.progress, selected.chunksDone)
    : null;

  const detailText = statChips
    ? ''
    : selected.stage === 'outline'
      ? selected.fileName
      : busy && selected.chunksTotal - selected.chunksDone > 1
        ? 'Sections commit in order as they land.'
        : (selected.currentChunkLabel ?? '');

  const activeStageIndex = getStageIndex(selected.stage);
  const currentStage = STAGES[activeStageIndex];

  const cancelAction = (
    <Button variant="destructive" onClick={() => onDiscard(selected)} className="ipc-action-btn">
      <Trash2 size={15} />Cancel import
    </Button>
  );

  return (
    <div
      className="ipc-card import-progress"
      role="status"
      aria-live="polite"
      data-motion-reduced={reduced || undefined}
    >
      {/* Stage stepper: horizontal with labels on >= 640px, compact dots + current stage on phones */}
      <ol className="ipc-stepper--desktop" aria-label="Import stages">
        {STAGES.map((step, idx) => {
          const isCompleted = idx < activeStageIndex;
          const isCurrent = idx === activeStageIndex;
          const isFuture = idx > activeStageIndex;
          const isLineComplete = idx < activeStageIndex;

          return (
            <li
              key={step.key}
              className={`ipc-step ${isCompleted ? 'ipc-step--completed' : ''} ${isCurrent ? 'ipc-step--current' : ''} ${isFuture ? 'ipc-step--future' : ''}`}
              aria-current={isCurrent ? 'step' : undefined}
            >
              <div className="ipc-step-badge">
                {isCompleted ? (
                  <Check size={13} strokeWidth={2.5} aria-hidden="true" />
                ) : (
                  <span className="ipc-step-num">{idx + 1}</span>
                )}
              </div>
              <span className="ipc-step-label">{step.label}</span>
              {idx < STAGES.length - 1 && (
                <div className={`ipc-step-line ${isLineComplete ? 'is-complete' : ''}`} aria-hidden="true" />
              )}
            </li>
          );
        })}
      </ol>

      <div className="ipc-stepper-mobile" aria-label="Import stages">
        <div className="ipc-mobile-dots" aria-hidden="true">
          {STAGES.map((step, idx) => {
            const isCompleted = idx < activeStageIndex;
            const isCurrent = idx === activeStageIndex;
            return (
              <span
                key={step.key}
                className={`ipc-mobile-dot ${isCompleted ? 'is-completed' : ''} ${isCurrent ? 'is-current' : ''}`}
              />
            );
          })}
        </div>
        <div className="ipc-mobile-label">
          <span className="ipc-mobile-step-num">Step {activeStageIndex + 1} of {STAGES.length}</span>
          <span className="ipc-mobile-sep" aria-hidden="true">·</span>
          <strong className="ipc-mobile-step-name">{currentStage?.label ?? 'Processing'}</strong>
        </div>
      </div>

      {/* Status line */}
      <div className="ipc-status-line import-progress-line">
        <span className="ipc-status-label import-progress-label">{label}</span>
        {percent !== null && (
          <span className="ipc-status-percent import-progress-percent">{percent}%</span>
        )}
      </div>

      {/* Slim progress track */}
      <div
        className={`ipc-progress-track import-progress-track ${percent === null ? 'indeterminate' : ''}`}
        role="progressbar"
        aria-label={label}
        aria-valuenow={percent ?? undefined}
        aria-valuemin={percent === null ? undefined : 0}
        aria-valuemax={percent === null ? undefined : 100}
      >
        <div
          className="ipc-progress-fill import-progress-fill"
          style={percent === null ? undefined : { width: `${percent}%` }}
        />
      </div>

      {/* Footer: Stat chips or detail text + Action */}
      {(Boolean(statChips?.length) || Boolean(detailText) || Boolean(cancelAction)) && (
        <div className="ipc-footer import-progress-footer">
          <div className="ipc-footer-info">
            {statChips ? (
              <div className="ipc-stat-chips" role="group" aria-label="Section processing stats">
                {statChips.map(chip => (
                  <span key={chip.id} className={`ipc-stat-chip ipc-stat-chip--${chip.tone}`}>
                    <strong className="ipc-stat-number">{chip.count}</strong>
                    <span className="ipc-stat-label">{chip.label}</span>
                  </span>
                ))}
              </div>
            ) : detailText ? (
              <p className="ipc-detail-text">{detailText}</p>
            ) : null}
          </div>
          <div className="ipc-actions import-progress-actions">{cancelAction}</div>
        </div>
      )}
    </div>
  );
}
