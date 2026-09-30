import { useLayoutEffect, useRef, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** The conversation pieces that should pull the view to the newest content when they change. */
  messages: unknown;
  pendingReply: unknown;
  actionBatches: unknown;
}

/**
 * The scrolling conversation. It owns the follow-the-newest behaviour so it also runs when the
 * dialog mounts after the conversation has already loaded, which an effect in the parent would miss.
 */
export function AiLog({ children, messages, pendingReply, actionBatches }: Props) {
  const log = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = log.current;
    if (!element) return;
    const follow = () => { element.scrollTop = element.scrollHeight; };
    follow();
    // Web fonts and the dialog's entrance can still change the height a frame later.
    const frame = requestAnimationFrame(follow);
    return () => cancelAnimationFrame(frame);
  }, [messages, pendingReply, actionBatches]);
  return <div className="ai-chat-log" ref={log} role="log" aria-label="Conversation" aria-live="polite">{children}</div>;
}
