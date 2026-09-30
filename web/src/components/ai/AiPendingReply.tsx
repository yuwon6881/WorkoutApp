import { AiMessageContent } from './AiMessageContent';

export interface PendingTurnState { status: string | null; text: string }

/** Streams the reply as it arrives; until then a thin track echoes the rest timer while the assistant reads history. */
export function AiPendingReply({ reply }: { reply: PendingTurnState }) {
  return <div className="ai-chat-message assistant" data-testid="ai-pending-reply">
    <span className="ai-chat-message-label">Coach</span>
    {reply.text ? <AiMessageContent content={reply.text} role="assistant" />
      : <span className="ai-chat-pending" role="status">
        <span>{reply.status ?? 'Thinking'}…</span>
        <span className="ai-chat-track" aria-hidden="true"><span /></span>
      </span>}
  </div>;
}
