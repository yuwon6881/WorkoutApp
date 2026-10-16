import { Check, Trash2, X } from 'lucide-react';
import type { ImportView } from '../types';
import { importProgressEstimate, sectionStates, summarizeSections, type SectionState } from '../lib/importProgress';
import type { ImportProgress } from './useImportPipeline';
import { formatElapsed, useLiveImportPercent } from './useLiveImportPercent';
import { Button } from './ui/Button';
import { useReducedMotion } from './ui/Motion';
import './ImportProgressCard.css';

/// What the import is doing. Sections are read side by side, so the line counts how many have
/// been read rather than naming one; a repair is called out because it is a second read.
function stageLabel(view: ImportView, states: readonly SectionState[], reading: boolean) {
  if (view.stage === 'outline') return 'Reading the outline';
  if (view.stage === 'select') return 'Waiting for your choice';
  const counts = summarizeSections(states);
  if (counts.repairing > 0) return `Repairing ${counts.repairing} section${counts.repairing === 1 ? '' : 's'}`;
  const read = counts.committed + counts.saved + counts.checking;
  if (view.stage === 'verify' && states.length > 0 && read === states.length) return 'Checking the whole program against the PDF';
  if (view.stage === 'recover') return 'Repairing source discrepancies';
  if (states.length > 0 && (reading || read > 0)) return `${read} of ${states.length} sections read`;
  return `Section ${Math.min(view.chunksDone + 1, view.chunksTotal)} of ${view.chunksTotal}`;
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

/// One chip per state that holds a section, in the order a section moves through them. The chips
/// share the section tiles' colours, so they double as the tiles' legend. Done is always shown.
function getStatChips(states: readonly SectionState[]): StatChip[] {
  const counts = summarizeSections(states);
  const chips: StatChip[] = [
    { id: 'done', count: counts.committed + counts.saved, label: 'done', tone: 'accent' },
    { id: 'checking', count: counts.checking, label: 'checking', tone: 'amber' },
    { id: 'repairing', count: counts.repairing, label: 'repairing', tone: 'red' },
    { id: 'reading', count: counts.reading, label: 'reading', tone: 'blue' },
    { id: 'queued', count: counts.queued, label: 'queued', tone: 'default' }
  ];
  return chips.filter(chip => chip.id === 'done' || chip.count > 0);
}

/// Where every section stands, one tile each in outline order, so a pass of twenty sections shows
/// its sections landing rather than a single number.
function SectionTiles({ states }: { states: readonly SectionState[] }) {
  const counts = summarizeSections(states);
  const summary = `${states.length} sections: ${counts.committed + counts.saved} done, ${counts.checking} checking, `
    + `${counts.repairing} repairing, ${counts.reading} reading, ${counts.queued} queued`;
  return (
    <div className="ipc-sections" role="img" aria-label={summary}>
      {states.map((state, index) => <span key={index} className={`ipc-section ipc-section--${state}`} />)}
    </div>
  );
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
  return <ServerProgress selected={selected} busy={busy} reduced={reduced} onDiscard={onDiscard} />;
}

function ServerProgress({ selected, busy, reduced, onDiscard }: {
  selected: ImportView;
  busy: boolean;
  reduced: boolean;
  onDiscard: (view: ImportView) => void;
}) {
  const states = selected.stage === 'outline' ? [] : sectionStates(selected);
  const label = stageLabel(selected, states, busy);
  const { percent, elapsedSeconds } = useLiveImportPercent(importProgressEstimate(selected), selected.progress?.startedAtUtc);
  const statChips = states.length > 0 ? getStatChips(states) : null;
  const detailText = statChips ? '' : selected.stage === 'outline' ? selected.fileName : (selected.currentChunkLabel ?? '');

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

      {/* Status line: what is happening, how far, and for how long */}
      <div className="ipc-status-line import-progress-line">
        <span className="ipc-status-label import-progress-label">{label}</span>
        {(percent !== null || elapsedSeconds !== null) && (
          <span className="ipc-status-percent import-progress-percent">
            {percent !== null && <span>{percent}%</span>}
            {elapsedSeconds !== null && (
              <span className="ipc-elapsed" aria-label={`${formatElapsed(elapsedSeconds)} elapsed`}>{formatElapsed(elapsedSeconds)}</span>
            )}
          </span>
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

      {states.length > 0 && <SectionTiles states={states} />}

      {/* Footer: section chips (the tiles' legend) or detail text, and the cancel action */}
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
    </div>
  );
}
