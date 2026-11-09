import { FileJson, Upload } from 'lucide-react';
import { Button } from './ui/Button';
import './ImportSourceBar.css';

/// The slim bar above an open import: which JSON file the draft came from, and the way to replace
/// it. The entry panel is hidden while a draft is open, so this is the only upload control left.
export function ImportSourceBar({ fileName, busy, onChooseFile }: {
  fileName?: string;
  busy: boolean;
  onChooseFile: () => void;
}) {
  return (
    <section className="panel import-source-bar" aria-label="Source JSON">
      <div className="isb-bar">
        <div className="isb-main">
          <div className="isb-icon-tile" aria-hidden="true">
            <FileJson size={18} />
          </div>
          <div className="isb-info">
            <h2 className="isb-heading">Source JSON</h2>
            <span className="isb-filename" title={fileName}>
              {fileName || 'Program JSON'}
            </span>
          </div>
        </div>
        <div className="isb-action">
          <Button variant="secondary" disabled={busy} onClick={onChooseFile} className="isb-choose-btn">
            <Upload size={15} aria-hidden="true" />
            Choose a JSON file
          </Button>
        </div>
      </div>
    </section>
  );
}
