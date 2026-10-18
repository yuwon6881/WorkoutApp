import { ArrowLeft } from 'lucide-react';
import { Button } from './Button';

/// The one way back out of a full-page flow (import, builder, program editor), named for where it
/// leads so the destination is never a guess.
export function BackButton({ to, onClick, disabled }: { to: string; onClick: () => void; disabled?: boolean }) {
  return <div className="back-nav-row">
    <Button presentation="plain" className="back-button" onClick={onClick} disabled={disabled}>
      <span className="back-button-icon" aria-hidden="true"><ArrowLeft size={15} /></span>
      <span className="back-button-label">Back to {to}</span>
    </Button>
  </div>;
}
