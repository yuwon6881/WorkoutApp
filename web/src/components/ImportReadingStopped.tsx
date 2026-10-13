import { AlertTriangle, RotateCcw, Trash2 } from 'lucide-react';
import { Button } from './ui/Button';
import './ImportFailures.css';

/// A read that stopped part-way (provider timeout, lost connection). The sections already
/// committed are kept, so the lifter can resume instead of starting over.
export function ImportReadingStopped({ error, busy, onRetry, onDiscard }: {
  error: string;
  busy: boolean;
  onRetry: () => void;
  onDiscard: () => void;
}) {
  return (
    <section className="panel ifail-panel ifail-reading-panel" aria-labelledby="reading-stopped-title">
      <header className="ifail-header">
        <div className="ifail-icon-tile warning" aria-hidden="true">
          <AlertTriangle size={22} />
        </div>
        <div className="ifail-heading">
          <h3 id="reading-stopped-title" className="ifail-title">Reading stopped</h3>
          <p className="ifail-subtitle muted">The read stopped part-way. You can resume without losing progress.</p>
        </div>
      </header>

      <div className="ifail-reason warning" role="alert">
        <p className="ifail-reason-message">{error}</p>
      </div>

      <div className="ifail-actions">
        <Button variant="destructive" disabled={busy} onClick={onDiscard} className="ifail-btn-secondary">
          <Trash2 size={15} />Cancel import
        </Button>
        <Button variant="primary" disabled={busy} onClick={onRetry} className="ifail-btn-primary">
          <RotateCcw size={15} />Retry reading
        </Button>
      </div>
    </section>
  );
}
