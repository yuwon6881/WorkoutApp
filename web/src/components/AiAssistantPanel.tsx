import { useMemo } from 'react';
import { AlertTriangle, SquarePen, Sparkles, X } from 'lucide-react';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { AiActionReview } from './ai/AiActionReview';
import { AiComposer } from './ai/AiComposer';
import { AiEmptyState } from './ai/AiEmptyState';
import { AiLog } from './ai/AiLog';
import { AiMessageContent } from './ai/AiMessageContent';
import { AiPendingReply } from './ai/AiPendingReply';
import { useAiConversation, type AiInvocationRequest } from './useAiConversation';
import type { AiUiAction } from '../lib/api/ai';
import './AiAssistantPanel.css';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onActions: (actions: AiUiAction[]) => void | Promise<void>;
  invocation?: AiInvocationRequest | null;
  onInvocationConsumed?: () => void;
  surface?: string;
}

export function AiAssistantPanel({ isOpen, onClose, onActions, invocation, onInvocationConsumed, surface = 'dashboard' }: Props) {
  const defaultContext = useMemo(() => ({ surface, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }), [surface]);
  const chat = useAiConversation({ isOpen, onClose, onActions, invocation, onInvocationConsumed, defaultContext });
  const disabled = chat.isSending || chat.isHydrating || chat.isResetting || chat.isResolving;
  const isEmpty = !chat.isHydrating && chat.messages.length === 0 && !chat.pendingReply;
  if (!isOpen) return null;
  return (
    <Modal title="Ask AI" onClose={onClose} wide headless className="ai-assistant-modal">
      <div className="ai-chat">
        <header className="ai-chat-header" data-sheet-handle>
          <span className="ai-chat-badge" aria-hidden="true"><Sparkles size={18} /></span>
          <div className="ai-chat-heading">
            <h2>Ask AI</h2>
            <span>Training assistant</span>
          </div>
          {chat.hasConversation && <Button variant="tertiary" aria-label="New chat" disabled={disabled}
            onClick={() => void chat.resetConversation()}>
            <SquarePen size={16} aria-hidden="true" /><span>{chat.isResetting ? 'Resetting…' : 'New chat'}</span>
          </Button>}
          <Button variant="tertiary" aria-label="Close dialog" onClick={onClose}><X size={20} aria-hidden="true" /></Button>
        </header>
        <AiLog messages={chat.messages} pendingReply={chat.pendingReply} actionBatches={chat.pendingActionBatches}>
          {chat.isHydrating && <p className="ai-chat-loading" role="status">Loading conversation…</p>}
          {isEmpty && <AiEmptyState disabled={disabled || Boolean(chat.error)} onPick={prompt => void chat.sendMessage(prompt)} />}
          {chat.messages.map((message, index) => <div key={index} className={`ai-chat-message ${message.role}`}>
            {message.role === 'assistant' && <span className="ai-chat-message-label">Coach</span>}
            <AiMessageContent content={message.content} role={message.role} />
          </div>)}
          {chat.pendingReply && <AiPendingReply reply={chat.pendingReply} />}
          {chat.pendingActionBatches.map(batch => <AiActionReview key={batch.batchId} batch={batch} disabled={disabled}
            onResolve={decision => void chat.resolveBatch(batch.batchId, decision)} />)}
        </AiLog>
        {chat.error && <div className="error-banner ai-chat-error" role="alert">
          <AlertTriangle size={17} aria-hidden="true" />
          <span>{chat.error}</span>
          {chat.lastFailedTurn ? <Button disabled={disabled} onClick={chat.retryLastFailedTurn}>Retry message</Button>
            : <Button disabled={disabled} onClick={() => void chat.hydrate()}>Reload conversation</Button>}
        </div>}
        <AiComposer value={chat.input} onChange={chat.setInput} onSubmit={() => void chat.sendMessage()}
          onStop={chat.stopTurn} isSending={chat.isSending} disabled={disabled} />
      </div>
    </Modal>
  );
}
