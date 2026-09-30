import { Fragment } from 'react';
import { parseAiMessage } from '../../lib/aiMessage';

const BOLD_OR_CODE_TOKEN = /(\*\*[^*\r\n]+?\*\*|`[^`\r\n]+?`)/g;

function Inline({ text }: { text: string }) {
  return <>{text.split(BOLD_OR_CODE_TOKEN).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) return <code key={index}>{part.slice(1, -1)}</code>;
    return <Fragment key={index}>{part}</Fragment>;
  })}</>;
}

/** Safe, lightweight reply formatter: bold, code snippets, headings, lists, and line breaks. */
export function AiMessageContent({ content, role }: { content: string; role: 'user' | 'assistant' }) {
  if (role === 'user') return <span className="ai-message-content user">{content}</span>;
  return <div className="ai-message-content">
    {parseAiMessage(content).map((block, index) => {
      switch (block.kind) {
        case 'heading':
          return <p key={index} className="ai-message-heading"><Inline text={block.text} /></p>;
        case 'bullets':
          return <ul key={index}>{block.items.map((item, i) => <li key={i}><Inline text={item} /></li>)}</ul>;
        case 'numbered':
          return <ol key={index} start={block.start}>{block.items.map((item, i) => <li key={i}><Inline text={item} /></li>)}</ol>;
        case 'paragraph':
          return <p key={index}>{block.lines.map((line, i) => <Fragment key={i}>{i > 0 && <br />}<Inline text={line} /></Fragment>)}</p>;
      }
    })}
  </div>;
}
