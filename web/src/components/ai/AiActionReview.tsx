import { ArrowUpRight } from 'lucide-react';
import { Button } from '../ui/Button';
import type { AiActionBatch, AiActionType } from '../../lib/api/ai';

const actionLabels: Record<AiActionType, string> = {
  openWorkout: 'View workout',
  openExercise: 'View exercise progress',
  openProgram: 'View program',
  openHistory: 'View workout history',
  openActiveWorkout: 'View active workout',
  openAddWorkoutDraft: 'Preview workout before starting',
};

interface Props {
  batch: AiActionBatch;
  disabled: boolean;
  onResolve: (decision: 'accepted' | 'dismissed') => void;
}

export function AiActionReview({ batch, disabled, onResolve }: Props) {
  return <section className="ai-chat-review" aria-label="Suggested screen">
    <div className="ai-chat-review-title">
      <span className="ai-chat-review-icon" aria-hidden="true"><ArrowUpRight size={16} /></span>
      <p>{batch.actions.map(action => actionLabels[action.type]).join(', ')}</p>
    </div>
    {batch.actions.map((action, index) => {
      const detail = [action.payload.query, action.payload.date, action.payload.time]
        .filter(value => typeof value === 'string').join(' · ');
      return detail ? <small className="ai-chat-action-detail" key={index}>{detail}</small> : null;
    })}
    <small>Opens the existing screen. Changes still need your confirmation there.</small>
    <div className="ai-chat-actions">
      <Button disabled={disabled} onClick={() => onResolve('dismissed')}>Dismiss</Button>
      <Button variant="primary" disabled={disabled} onClick={() => onResolve('accepted')}>Open</Button>
    </div>
  </section>;
}
