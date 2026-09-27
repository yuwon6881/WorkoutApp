import { AlertTriangle, ChevronDown, FileText, Trash2, Upload } from 'lucide-react';
import type { ImportView } from '../types';
import { importFailureSteps, importIssueCopy } from '../lib/importIssueCopy';
import { Button } from './ui/Button';

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
    <section className="panel import-failed-panel" aria-labelledby="import-failed-title">
      <header className="import-failed-header">
        <span className="import-failed-icon" aria-hidden="true"><AlertTriangle size={20} /></span>
        <div className="import-failed-heading">
          <h3 id="import-failed-title">This PDF could not be imported</h3>
          <p className="muted"><FileText size={14} aria-hidden="true" />{view.fileName}</p>
        </div>
      </header>

      <div className="import-failed-reason" role="alert">
        <div className="import-failed-reason-title">
          <strong>{copy?.title ?? 'The read could not be completed'}</strong>
          {issue?.sourcePage && <span className="pill">PDF page {issue.sourcePage}</span>}
        </div>
        <p className="import-failed-message">{issue ? issue.message : plainMessage(view.error)}</p>
        {copy?.hint && <p className="muted">{copy.hint}</p>}
      </div>

      <div className="import-failed-steps">
        <h4>What you can do</h4>
        <ol>{steps.map(step => <li key={step}>{step}</li>)}</ol>
      </div>

      {others.length > 0 && <details className="import-failed-more">
        <summary>{others.length} more {others.length === 1 ? 'item' : 'items'} to check<ChevronDown size={16} aria-hidden="true" /></summary>
        <ul>{others.map((item, index) => <li key={`${item.code}-${item.sourcePage ?? ''}-${index}`}>
          <strong>{importIssueCopy(item.code, item.message).title}</strong>
          {item.sourcePage ? <span className="muted"> · PDF page {item.sourcePage}</span> : null}
          <p>{item.message}</p>
        </li>)}</ul>
      </details>}

      <details className="import-failed-technical">
        <summary>Technical details<ChevronDown size={16} aria-hidden="true" /></summary>
        <p>{view.error}</p>
      </details>

      <div className="reading-card-actions">
        <Button variant="destructive" disabled={busy} onClick={onDiscard}><Trash2 size={15} />Discard import</Button>
        <Button variant="primary" disabled={busy} onClick={onChooseFile}><Upload size={15} />Choose another PDF</Button>
      </div>
    </section>
  );
}
