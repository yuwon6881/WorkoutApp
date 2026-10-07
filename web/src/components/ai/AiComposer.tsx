import { useEffect, useLayoutEffect, useRef } from 'react';
import { ArrowUp, Square } from 'lucide-react';
import { Button } from '../ui/Button';
import { hasFinePointer } from '../../lib/inputModality';

const MAX_LENGTH = 2000;
const COUNTER_FROM = 1800;
const MAX_HEIGHT = 160;

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  isSending: boolean;
  disabled: boolean;
}


export function AiComposer({ value, onChange, onSubmit, onStop, isSending, disabled }: Props) {
  const field = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const element = field.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, MAX_HEIGHT)}px`;
    element.style.overflowY = element.scrollHeight > MAX_HEIGHT ? 'auto' : 'hidden';
  }, [value]);

  // A disabled field drops focus, so hand it back once a reply, reset, or reload settles. On the
  // first mount the dialog opens in an effect that runs after this one, so focus waits a microtask.
  useEffect(() => {
    if (disabled || !hasFinePointer()) return;
    queueMicrotask(() => field.current?.focus({ preventScroll: true }));
  }, [disabled]);

  return <form className="ai-chat-composer" onSubmit={event => { event.preventDefault(); onSubmit(); }}>
    <div className="ai-chat-composer-box">
      <label htmlFor="ai-chat-message" className="ai-chat-sr-only">Message</label>
      <textarea id="ai-chat-message" ref={field} rows={1} maxLength={MAX_LENGTH} value={value} disabled={disabled}
        placeholder="Ask about a workout, lift, or program" onChange={event => onChange(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            onSubmit();
          }
        }} />
      {isSending
        ? <Button aria-label="Stop generating" onClick={onStop}><Square size={16} aria-hidden="true" /></Button>
        : <Button type="submit" variant="primary" aria-label="Send message" disabled={disabled || !value.trim()}>
          <ArrowUp size={18} aria-hidden="true" /></Button>}
    </div>
    {value.length >= COUNTER_FROM && <small className="ai-chat-counter" aria-live="polite">{value.length}/{MAX_LENGTH}</small>}
  </form>;
}
