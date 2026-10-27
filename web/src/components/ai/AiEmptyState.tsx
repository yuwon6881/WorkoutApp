import { BicepsFlexed, ChevronRight, History, TrendingUp, type LucideIcon } from 'lucide-react';
import { Button } from '../ui/Button';

/** The middle prompt speaks to the workout coming up when there is one; otherwise a common lift. */
export function suggestedPrompts(nextWorkoutName?: string | null): { text: string; icon: LucideIcon }[] {
  return [
    { text: 'Show my most recent workouts', icon: History },
    nextWorkoutName
      ? { text: `What should I aim for in ${nextWorkoutName}?`, icon: TrendingUp }
      : { text: 'How is my strength progressing on Squat?', icon: TrendingUp },
    { text: 'What is my training volume balance across muscles?', icon: BicepsFlexed },
  ];
}

export function AiEmptyState({ disabled, onPick, nextWorkoutName }: {
  disabled: boolean;
  onPick: (prompt: string) => void;
  nextWorkoutName?: string | null;
}) {
  const prompts = suggestedPrompts(nextWorkoutName);
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
