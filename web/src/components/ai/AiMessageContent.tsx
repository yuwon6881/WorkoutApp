import { Fragment } from 'react';

const BOLD_OR_CODE_TOKEN = /(\*\*[^*\r\n]+?\*\*|`[^`\r\n]+?`)/g;

/** Safe, lightweight reply formatter: bold, code snippets, lists, and line breaks. */
export function AiMessageContent({
  content,
  role,
}: {
  content: string;
  role: 'user' | 'assistant';
}) {
  if (role === 'user') {
    return <span className="ai-message-content">{content}</span>;
  }

  const lines = content.split('\n');

  return (
    <div className="ai-message-content">
      {lines.map((line, lineIndex) => {
        const trimmed = line.trim();
        if (trimmed.length === 0) {
          return <div key={lineIndex} className="" />;
        }

        const isBullet = trimmed.startsWith('- ') || trimmed.startsWith('• ') || trimmed.startsWith('* ');
        const isNumbered = /^\d+\.\s/.test(trimmed);

        const textContent = isBullet
          ? trimmed.slice(2)
          : isNumbered
            ? trimmed.replace(/^\d+\.\s*/, '')
            : line;

        const renderedLine = textContent.split(BOLD_OR_CODE_TOKEN).map((part, index) => {
          if (part.startsWith('**') && part.endsWith('**')) {
            return <strong key={index} className="">{part.slice(2, -2)}</strong>;
          }
          if (part.startsWith('`') && part.endsWith('`')) {
            return (
              <code key={index} className="">
                {part.slice(1, -1)}
              </code>
            );
          }
          return <Fragment key={index}>{part}</Fragment>;
        });

        if (isBullet) {
          return (
            <div key={lineIndex} className="ai-message-line">
              <span className="">•</span>
              <span>{renderedLine}</span>
            </div>
          );
        }

        if (isNumbered) {
          const numMatch = trimmed.match(/^(\d+)\./);
          return (
            <div key={lineIndex} className="ai-message-line">
              <span className="">{numMatch?.[1]}.</span>
              <span>{renderedLine}</span>
            </div>
          );
        }

        return <div key={lineIndex}>{renderedLine}</div>;
      })}
    </div>
  );
}
