import { Fragment, useState } from 'react';
import { AlertTriangle, ChevronRight } from 'lucide-react';
import type { AttentionRow, ImportIssueTarget } from '../lib/importAttentionRows';
import { Button } from './ui/Button';
import './ImportReview.css';

const COLLAPSED_ROWS = 5;

/// What must be settled before the program can be created: unmapped exercises and review items,
/// each with a button that jumps to the place in the draft it points to.
export function ImportReviewIssues({ rows, onFocusIssue }: {
  rows: AttentionRow[];
  onFocusIssue: (target: ImportIssueTarget) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  if (rows.length === 0) return null;

  const visible = showAll ? rows : rows.slice(0, COLLAPSED_ROWS);
  const unmappedCount = rows.filter(r => r.title.startsWith('Map ')).length;
  const reviewCount = rows.length - unmappedCount;

  return (
    <section className="irev-issues-section" aria-labelledby="import-review-issues-title">
      <div className="irev-issues-heading">
        <div className="irev-issues-title-group">
          <h3 id="import-review-issues-title" className="irev-issues-title">Needs attention</h3>
          <p className="muted irev-issues-desc">
            Resolve each item before creating the program. Editing what an item points to marks it reviewed; undoing the edit or restoring the draft brings it back.
          </p>
        </div>
        <span className="pill irev-count-pill">{rows.length} {rows.length === 1 ? 'item' : 'items'}</span>
      </div>

      <div className="irev-table" role="table" aria-label="Import issues">
        <div className="irev-table-head" role="row">
          <span className="irev-col-header irev-col--issue" role="columnheader">Issue</span>
          <span className="irev-col-header irev-col--source" role="columnheader">Source</span>
          <span className="irev-col-header irev-col-header--action irev-col--action" role="columnheader">Action</span>
        </div>

        {visible.map((row, index) => {
          const showDivider = unmappedCount > 0 && reviewCount > 0 && !row.title.startsWith('Map ') && (index > 0 && visible[index - 1].title.startsWith('Map '));
          return (
            <Fragment key={row.key}>
              {showDivider && (
                <div className="irev-divider-row" role="row">
                  <div className="irev-divider-cell" role="cell">
                    <span className="irev-divider-label">Review items ({reviewCount})</span>
                  </div>
                </div>
              )}
              <div className="irev-row" role="row">
                <div className="irev-cell irev-cell--issue" role="cell">
                  <div className="irev-issue-header">
                    <AlertTriangle size={15} className="irev-issue-icon" />
                    <strong className="irev-issue-title" title={row.title}>{row.title}</strong>
                  </div>
                  {row.message && <span className="irev-issue-message">{row.message}</span>}
                </div>
                <div className="irev-cell irev-cell--source" role="cell">
                  <span className="irev-source-text">{row.detail}</span>
                </div>
                <div className="irev-cell irev-cell--action" role="cell">
                  <Button
                    variant="secondary"
                    className="irev-action-btn"
                    aria-label={row.ariaLabel}
                    onClick={() => onFocusIssue(row.target)}
                  >
                    <span>{row.action}</span>
                    <ChevronRight size={14} />
                  </Button>
                </div>
              </div>
            </Fragment>
          );
        })}
      </div>

      {rows.length > COLLAPSED_ROWS && (
        <div className="irev-footer">
          <span className="irev-footer-count">Showing {visible.length} of {rows.length}</span>
          <Button
            variant="tertiary"
            className="irev-footer-toggle"
            onClick={() => setShowAll(value => !value)}
          >
            {showAll ? 'Show fewer' : `Show all ${rows.length}`}
          </Button>
        </div>
      )}
    </section>
  );
}
