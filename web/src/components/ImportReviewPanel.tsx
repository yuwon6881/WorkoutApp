import { forwardRef } from 'react';
import { AlertTriangle, Check, Info } from 'lucide-react';
import type { ImportDraft, ImportView } from '../types';
import type { AttentionRow, ImportIssueTarget } from '../lib/importAttentionRows';
import { Field } from './ui/Field';
import { ImportReviewIssues } from './ImportReviewIssues';
import './ImportReview.css';

/// The head of the review step: the program name, what could not be linked to the catalog, and
/// the items that block creating the program.
export const ImportReviewPanel = forwardRef<HTMLElement, {
  view: ImportView;
  draft: ImportDraft;
  attentionRows: AttentionRow[];
  onNameChange: (name: string) => void;
  onNameCommit: () => void;
  onFocusIssue: (target: ImportIssueTarget) => void;
}>(function ImportReviewPanel({ view, draft, attentionRows, onNameChange, onNameCommit, onFocusIssue }, ref) {
  return (
    <section className="panel irev-panel" ref={ref}>
      <div className="irev-header">
        <div className="irev-header-title-row">
          <h2>Review</h2>
          {attentionRows.length === 0 ? (
            <span className="irev-status-chip irev-status-chip--ready">
              <Check size={14} />
              <span>Ready to create</span>
            </span>
          ) : (
            <span className="irev-status-chip irev-status-chip--attention">
              <AlertTriangle size={14} />
              <span>{attentionRows.length} to resolve</span>
            </span>
          )}
        </div>
        {!view.acceptable && (
          <p className="muted irev-notice-copy" role="status">
            The program can be created after every review item is resolved.
          </p>
        )}
      </div>

      <Field
        label="Program name"
        name="import-program-name"
        value={draft.programName}
        onChange={event => onNameChange(event.target.value)}
        onBlur={onNameCommit}
        className="irev-name-field"
      />

      {view.unresolved.length > 0 && (
        <div className="irev-unresolved-banner" role="status">
          <Info size={16} className="irev-unresolved-icon" />
          <span className="irev-unresolved-text">
            {view.unresolved.length} exercise slot{view.unresolved.length === 1 ? ' is' : 's are'} not linked to the catalog. Unmapped names stay verbatim and can still be logged.
          </span>
        </div>
      )}

      <ImportReviewIssues rows={attentionRows} onFocusIssue={onFocusIssue} />
    </section>
  );
});
