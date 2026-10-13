import { AlertTriangle, ChevronDown, FileText, Trash2, Upload } from 'lucide-react';
import type { ImportView } from '../types';
import { importFailureSteps, importIssueCopy } from '../lib/importIssueCopy';
import { Button } from './ui/Button';
import './ImportFailures.css';

type Issue = NonNullable<ImportView['reviewIssues']>[number];

/// The issue that stopped the import: the one its terminal message names, else the first that is
/// more than a note.
function stoppingIssue(view: ImportView): Issue | null {
  const actionable = (view.reviewIssues ?? []).filter(issue => issue.severity !== 'info');
  return actionable.find(issue => view.error.includes(`[${issue.code}]`)) ?? actionable[0] ?? null;
}

/// Without a structured issue, the terminal message is shown without its bracketed code.
function plainMessage(message: string): string {
  return message.replace(/\s*\[[a-z0-9_]+\](?=\s|:|$)/gi, '').trim();
}

/// An import the server refused to finish. It says what was doubted, where in the PDF, and what
/// the lifter can do next, with the technical detail kept out of the way.
export function ImportFailedPanel({ view, busy, onChooseFile, onDiscard }: {
  view: ImportView;
  busy: boolean;
  onChooseFile: () => void;
  onDiscard: () => void;
}) {
  const issue = stoppingIssue(view);
  const copy = issue ? importIssueCopy(issue.code, issue.message) : null;
  const others = (view.reviewIssues ?? []).filter(item => item.severity !== 'info' && item !== issue);
  const steps = importFailureSteps(issue?.sourcePage);

  return (
    <section className="panel ifail-panel" aria-labelledby="import-failed-title">
      <header className="ifail-header">
        <div className="ifail-icon-tile error" aria-hidden="true">
          <AlertTriangle size={22} />
        </div>
        <div className="ifail-heading">
          <h3 id="import-failed-title" className="ifail-title">This PDF could not be imported</h3>
          <div className="ifail-filename-chip" title={view.fileName}>
            <FileText size={13} aria-hidden="true" />
            <span className="ifail-filename-text">{view.fileName}</span>
          </div>
        </div>
      </header>

      <div className="ifail-reason error" role="alert">
        <div className="ifail-reason-header">
          <strong className="ifail-reason-title">{copy?.title ?? 'The read could not be completed'}</strong>
          {issue?.sourcePage && <span className="pill ifail-page-pill">PDF page {issue.sourcePage}</span>}
        </div>
        <p className="ifail-reason-message">{issue ? issue.message : plainMessage(view.error)}</p>
        {copy?.hint && <p className="ifail-reason-hint muted">{copy.hint}</p>}
      </div>

      <div className="ifail-steps">
        <h4 className="ifail-steps-heading">What you can do</h4>
        <ol className="ifail-steps-list">
          {steps.map((step, index) => (
            <li key={step} className="ifail-step-item">
              <span className="ifail-step-badge" aria-hidden="true">{index + 1}</span>
              <span className="ifail-step-text">{step}</span>
            </li>
          ))}
        </ol>
      </div>

      {others.length > 0 && (
        <details className="ifail-disclosure">
          <summary className="ifail-disclosure-summary">
            <span>{others.length} more {others.length === 1 ? 'item' : 'items'} to check</span>
            <ChevronDown size={16} className="ifail-disclosure-chevron" aria-hidden="true" />
          </summary>
          <ul className="ifail-disclosure-list">
            {others.map((item, index) => (
              <li key={`${item.code}-${item.sourcePage ?? ''}-${index}`} className="ifail-disclosure-item">
                <div className="ifail-disclosure-item-header">
                  <strong>{importIssueCopy(item.code, item.message).title}</strong>
                  {item.sourcePage ? <span className="muted"> · PDF page {item.sourcePage}</span> : null}
                </div>
                <p className="ifail-disclosure-item-msg">{item.message}</p>
              </li>
            ))}
          </ul>
        </details>
      )}

      <details className="ifail-disclosure">
        <summary className="ifail-disclosure-summary">
          <span>Technical details</span>
          <ChevronDown size={16} className="ifail-disclosure-chevron" aria-hidden="true" />
        </summary>
        <div className="ifail-disclosure-body">
          <p className="ifail-tech-error">{view.error}</p>
        </div>
      </details>

      <div className="ifail-actions">
        <Button variant="destructive" disabled={busy} onClick={onDiscard} className="ifail-btn-secondary">
          <Trash2 size={15} />Discard import
        </Button>
        <Button variant="primary" disabled={busy} onClick={onChooseFile} className="ifail-btn-primary">
          <Upload size={15} />Choose another PDF
        </Button>
      </div>
    </section>
  );
}
