import { ChevronRight } from 'lucide-react';
import type { ImportView } from '../types';
import { isStoppedImport } from '../lib/importSelection';
import { Button } from './ui/Button';
import './RenderWindow.css';

/// Older errors stay available for inspection and discard without becoming the current import.
export function StoppedImports({ imports, busy, onSelect }: {
  imports: ImportView[];
  busy: boolean;
  onSelect: (view: ImportView) => void;
}) {
  const stopped = imports.filter(isStoppedImport);
  if (!stopped.length) return null;
  return <details className="import-stopped-imports">
    <summary>Stopped imports ({stopped.length})</summary>
    <p className="muted">Previous attempts. Open one to see its error or discard it.</p>
    <ul className={stopped.length > 100 ? 'import-windowed' : undefined}>{stopped.map(view => <li key={view.id}>
      <Button variant="tertiary" disabled={busy} aria-label={`View ${view.fileName}`} onClick={() => onSelect(view)}>
        <span>{view.fileName}</span><ChevronRight size={16} aria-hidden="true" />
      </Button>
    </li>)}</ul>
  </details>;
}
