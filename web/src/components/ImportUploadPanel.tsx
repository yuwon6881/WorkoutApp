import { useState, type DragEvent, type ReactNode } from 'react';
import { ChevronDown, FileText, Upload } from 'lucide-react';
import { Button } from './ui/Button';
import './ImportSource.css';
import './ImportUploadPanel.css';
import './ImportSourceBar.css';
import './ImportPrivacyNote.css';

/// The top of the import screen: where the PDF is chosen and how it is read. Progress and feedback
/// arrive as children and earlier attempts as the footer, so the panel owns only its shell.
export function ImportUploadPanel({
  hasDraft,
  fileName,
  busy,
  onChooseFile,
  onDropFile,
  children,
  footer,
}: {
  hasDraft: boolean;
  fileName?: string;
  busy: boolean;
  onChooseFile: () => void;
  /** A file dropped on the panel goes the same way as a chosen one, through the same checks. */
  onDropFile?: (file: File) => void;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  const [dropping, setDropping] = useState(false);
  const accepts = (event: DragEvent) => !busy && Boolean(onDropFile) && event.dataTransfer.types.includes('Files');
  const drop = {
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (!accepts(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      setDropping(true);
    },
    onDragLeave: (event: DragEvent<HTMLElement>) => {
      // Moving between the panel's own children also fires a leave; only leaving the panel counts.
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropping(false);
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      setDropping(false);
      if (!accepts(event)) return;
      event.preventDefault();
      const dropped = event.dataTransfer.files[0];
      if (dropped) onDropFile?.(dropped);
    }
  };

  return (
    <section
      className={`panel import-upload-panel iup-panel${
        hasDraft ? ' has-draft iup-panel--draft' : ' iup-panel--empty'
      }${dropping ? ' iup-dropping' : ''}`}
      {...drop}
    >
      {hasDraft ? (
        <div className="iup-draft-bar">
          <div className="iup-draft-main">
            <div className="iup-draft-icon-tile" aria-hidden="true">
              <FileText size={18} />
            </div>
            <div className="iup-draft-info">
              <h2 className="iup-draft-heading">Source PDF</h2>
              <span className="iup-draft-filename" title={fileName}>
                {fileName || 'Program PDF'}
              </span>
            </div>
          </div>
          <div className="iup-draft-action upload-action-row">
            <Button
              variant="secondary"
              disabled={busy}
              onClick={onChooseFile}
              className="iup-draft-choose-btn"
            >
              <Upload size={15} aria-hidden="true" />
              Choose a PDF
            </Button>
          </div>
        </div>
      ) : (
        <div className={`iup-empty-hero${!busy ? ' iup-empty-hero--split' : ''}`}>
          <div className="iup-hero-area">
            <div className="iup-hero-top">
              <div className="iup-icon-tile" aria-hidden="true">
                <FileText size={30} />
              </div>
              <div className="iup-hero-text">
                <h2 className="iup-hero-title">Upload</h2>
                <p className="iup-hero-subtitle">
                  Select your workout PDF to convert it into an interactive training program.
                </p>
              </div>
            </div>
            <div className="iup-hero-actions upload-action-row">
              <Button
                variant="primary"
                disabled={busy}
                onClick={onChooseFile}
                className="iup-hero-choose-btn"
              >
                <Upload size={17} aria-hidden="true" />
                Choose a PDF
              </Button>
              <span className="iup-hero-meta">
                PDF · read on this device · up to 1,000 pages
                {onDropFile && <span className="iup-drop-hint"> · or drop it here</span>}
              </span>
            </div>
          </div>

          {!busy && (
            <div className="iup-steps-section">
              <div className="iup-steps-heading">
                <span className="iup-steps-title">What happens next</span>
              </div>
              <ol className="iup-steps-list">
                <li className="iup-step-item">
                  <span className="iup-step-badge" aria-hidden="true">
                    1
                  </span>
                  <div className="iup-step-body">
                    <span className="iup-step-text">Read on this device</span>
                    <span className="iup-step-desc">
                      The PDF text is extracted in your browser.
                    </span>
                  </div>
                </li>
                <li className="iup-step-item">
                  <span className="iup-step-badge" aria-hidden="true">
                    2
                  </span>
                  <div className="iup-step-body">
                    <span className="iup-step-text">
                      Pick a program if the PDF holds several
                    </span>
                    <span className="iup-step-desc">
                      You choose which program to import before details are read.
                    </span>
                  </div>
                </li>
                <li className="iup-step-item">
                  <span className="iup-step-badge" aria-hidden="true">
                    3
                  </span>
                  <div className="iup-step-body">
                    <span className="iup-step-text">Review and create</span>
                    <span className="iup-step-desc">
                      Fix anything flagged, then create the program.
                    </span>
                  </div>
                </li>
              </ol>
            </div>
          )}
        </div>
      )}

      {children}

      <details className="import-source-details iup-privacy-details" open={!hasDraft}>
        <summary className="iup-privacy-summary">
          <span>How your PDF is read</span>
          <ChevronDown size={16} className="iup-privacy-chevron" aria-hidden="true" />
        </summary>
        <p className="muted small-copy iup-privacy-text">
          The text is read from the PDF on this device and only that text is sent; the
          file itself stays here. It becomes an editable draft before it can affect your
          workouts.
        </p>
      </details>

      {footer}
    </section>
  );
}
