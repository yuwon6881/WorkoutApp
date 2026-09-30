import { BicepsFlexed, ChevronRight, History, TrendingUp, type LucideIcon } from 'lucide-react';
import { Button } from '../ui/Button';

const prompts: { text: string; icon: LucideIcon }[] = [
  { text: 'Show my most recent workouts', icon: History },
  { text: 'How is my strength progressing on Squat?', icon: TrendingUp },
  { text: 'What is my training volume balance across muscles?', icon: BicepsFlexed },
];

export function AiEmptyState({ disabled, onPick }: { disabled: boolean; onPick: (prompt: string) => void }) {
  return <div className="ai-chat-empty">
    <div className="ai-chat-empty-intro">
      <h3>Ask about your training</h3>
      <p>Answers come from your logged workouts, exercise history, and programs. Nothing changes without your confirmation.</p>
    </div>
    <ul className="ai-chat-prompts" aria-label="Suggested questions">
      {prompts.map(({ text, icon: Icon }) => <li key={text}>
        <Button disabled={disabled} onClick={() => onPick(text)}>
          <span className="ai-chat-prompt-icon" aria-hidden="true"><Icon size={17} /></span>
          <span className="ai-chat-prompt-copy">{text}</span>
          <ChevronRight size={16} className="ai-chat-prompt-go" aria-hidden="true" />
        </Button>
      </li>)}
    </ul>
  </div>;
}
