import { BicepsFlexed, ChevronRight, History, TrendingUp, type LucideIcon } from 'lucide-react';
import { Button } from '../ui/Button';

/** The middle prompt names the lift the user trains most; with no history it falls back to a common lift. */
export function suggestedPrompts(strengthLift?: string | null): { text: string; icon: LucideIcon }[] {
  return [
    { text: 'Show my most recent workouts', icon: History },
    { text: `How is my strength progressing on ${strengthLift ?? 'Squat'}?`, icon: TrendingUp },
    { text: 'What is my training volume balance across muscles?', icon: BicepsFlexed },
  ];
}

export function AiEmptyState({ disabled, onPick, strengthLift }: {
  disabled: boolean;
  onPick: (prompt: string) => void;
  strengthLift?: string | null;
}) {
  const prompts = suggestedPrompts(strengthLift);
  return <div className="ai-chat-empty">
    <div className="ai-chat-empty-intro">
      <h3>Ask about your training</h3>
      <p>Answers come from your logged workouts, exercise history, and programs. Nothing changes without your confirmation.</p>
    </div>
    <div>
      <p className="ai-chat-prompts-label" id="ai-chat-prompts-label">Try asking</p>
      <ul className="ai-chat-prompts" aria-labelledby="ai-chat-prompts-label">
        {prompts.map(({ text, icon: Icon }) => <li key={text}>
          <Button disabled={disabled} onClick={() => onPick(text)}>
            <span className="ai-chat-prompt-icon" aria-hidden="true"><Icon size={15} /></span>
            <span className="ai-chat-prompt-copy">{text}</span>
            <ChevronRight size={15} className="ai-chat-prompt-go" aria-hidden="true" />
          </Button>
        </li>)}
      </ul>
    </div>
  </div>;
}
