import { ChevronDown, ChevronRight, FileText } from 'lucide-react';
import type { ImportView } from '../types';
import { isStoppedImport } from '../lib/importSelection';
import { Button } from './ui/Button';
import './RenderWindow.css';
import './ImportFailures.css';

function formatStoppedMeta(view: ImportView): string | null {
  const parts: string[] = [];
  if (view.pages && view.pages > 0) {
    parts.push(`${view.pages} ${view.pages === 1 ? 'page' : 'pages'}`);
  }
  if (view.created) {
    const d = new Date(view.created);
    if (!isNaN(d.getTime())) {
      parts.push(d.toLocaleDateString());
    }
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

/// Older errors stay available for inspection and discard without becoming the current import.
export function StoppedImports({ imports, busy, onSelect }: {
  imports: ImportView[];
  busy: boolean;
  onSelect: (view: ImportView) => void;
}) {
  const stopped = imports.filter(isStoppedImport);
  if (!stopped.length) return null;

  return (
    <details className="ifail-stopped import-stopped-imports">
      <summary className="ifail-stopped-summary">
        <span>Stopped imports ({stopped.length})</span>
        <ChevronDown size={16} className="ifail-stopped-summary-chevron" aria-hidden="true" />
      </summary>
      <p className="ifail-stopped-desc">Previous attempts. Open one to see its error or discard it.</p>
      <ul className={`ifail-stopped-list${stopped.length > 100 ? ' import-windowed' : ''}`}>
        {stopped.map(view => {
          const meta = formatStoppedMeta(view);
          return (
            <li key={view.id} className="ifail-stopped-item">
              <Button
                variant="tertiary"
                disabled={busy}
                className="ifail-stopped-row"
                aria-label={`View ${view.fileName}`}
                onClick={() => onSelect(view)}
              >
                <span className="ifail-stopped-icon" aria-hidden="true">
                  <FileText size={16} />
                </span>
                <span className="ifail-stopped-text">
                  <span className="ifail-stopped-filename" title={view.fileName}>
                    {view.fileName}
                  </span>
                  {meta && <span className="ifail-stopped-meta">{meta}</span>}
                </span>
                <ChevronRight size={16} className="ifail-stopped-chevron" aria-hidden="true" />
              </Button>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
