import { AlertTriangle, X } from 'lucide-react';
import type { ImportFailure } from './useImportPipeline';
import { Button } from './ui/Button';
import './ImportFailures.css';

/// Every import failure carries the warning message that can be dismissed.
export function ImportFailureBanner({ failure, onDismiss }: { failure: ImportFailure; onDismiss: () => void }) {
  return (
    <div className="ifail-banner" role="alert">
      <div className="ifail-banner-icon" aria-hidden="true">
        <AlertTriangle size={16} />
      </div>
      <p className="ifail-banner-message">{failure.message}</p>
      <Button
        variant="tertiary"
        className="ifail-banner-dismiss"
        aria-label="Dismiss this message"
        onClick={onDismiss}
      >
        <X size={16} aria-hidden="true" />
      </Button>
    </div>
  );
}
