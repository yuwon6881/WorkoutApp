import {AlertTriangle, CheckCircle2, Info} from 'lucide-react';
import {Button} from './Button';
import './CardFeedback.css';

export type CardFeedbackTone = 'error' | 'warning' | 'success' | 'info';

export function CardFeedback({
  tone = 'error',
  title,
  message,
  detail,
  action,
}: {
  tone?: CardFeedbackTone;
  title?: string;
  message: string;
  /** Supporting diagnostics, shown only when the person opens the disclosure. */
  detail?: string;
  action?: {label: string; onClick: () => void; disabled?: boolean};
}) {
  const Icon = tone === 'success' ? CheckCircle2 : tone === 'info' ? Info : AlertTriangle;
  return (
    <div className={`card-feedback ${tone}`} role={tone === 'success' || tone === 'info' ? 'status' : 'alert'}>
      <span className="card-feedback-icon" aria-hidden="true"><Icon size={18} /></span>
      <div className="card-feedback-content">
        <div className="card-feedback-copy">
          {title && <strong>{title}</strong>}
          <p>{message}</p>
          {detail && (
            <details className="card-feedback-detail">
              <summary>Technical detail</summary>
              <p>{detail}</p>
            </details>
          )}
        </div>
        {action && (
          <Button type="button" variant={tone === 'error' ? 'secondary' : 'tertiary'} onClick={action.onClick} disabled={action.disabled}>
            {action.label}
          </Button>
        )}
      </div>
    </div>
  );
}
