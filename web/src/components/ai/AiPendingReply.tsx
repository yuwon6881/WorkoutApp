import { AiMessageContent } from './AiMessageContent';
export interface PendingTurnState { status: string | null; text: string }
export function AiPendingReply({ reply }: { reply: PendingTurnState }) {
  return <div className="ai-chat-message assistant" data-testid="ai-pending-reply">
    {reply.text ? <AiMessageContent content={reply.text} role="assistant" />
      : <span className="ai-chat-pending" role="status">{reply.status ?? 'Thinking'}…</span>}
  </div>;
}