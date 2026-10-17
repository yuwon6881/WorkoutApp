/**
 * One bullet. `children` are the more deeply indented bullets beneath it. A `leadIn` ends in a
 * colon and only introduces what follows, so it renders as a label rather than a bulleted point.
 */
export interface AiBulletItem {
  text: string;
  children: string[];
  leadIn: boolean;
}

export type AiMessageBlock =
  | { kind: 'heading'; text: string }
  | { kind: 'paragraph'; lines: string[] }
  | { kind: 'bullets'; items: AiBulletItem[] }
  | { kind: 'numbered'; start: number; items: string[] };

const HEADING = /^#{1,6}\s+(.+)$/;
const BULLET = /^[-*•]\s+(.+)$/;
const NUMBERED = /^(\d+)[.)]\s+(.+)$/;
const LEAD_IN = /:\s*(\*\*)?$/;
const TAB_WIDTH = 4;

function indentOf(raw: string): number {
  const leading = /^[ \t]*/.exec(raw)?.[0] ?? '';
  return [...leading].reduce((width, char) => width + (char === '\t' ? TAB_WIDTH : 1), 0);
}

/**
 * Splits an assistant reply into the few block shapes the chat renders. Only lists, headings, and
 * paragraphs are recognised: the reply is model output, so anything richer stays plain text.
 * A blank line between two items of one list does not end the list, because models often
 * separate numbered steps that way. Bullets nest one level: anything indented deeper than the
 * list's first bullet belongs to the bullet above it, however deep the model indented it.
 */
export function parseAiMessage(content: string): AiMessageBlock[] {
  const blocks: AiMessageBlock[] = [];
  let openList: Extract<AiMessageBlock, { kind: 'bullets' | 'numbered' }> | null = null;
  let openParagraph: Extract<AiMessageBlock, { kind: 'paragraph' }> | null = null;
  let bulletBaseIndent = 0;
  let afterBlank = false;

  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (!line) {
      openParagraph = null;
      afterBlank = true;
      continue;
    }
    const heading = HEADING.exec(line);
    const bullet = BULLET.exec(line);
    const numbered = NUMBERED.exec(line);
    if (heading) {
      blocks.push({ kind: 'heading', text: heading[1] });
      openList = null;
      openParagraph = null;
    } else if (bullet) {
      const indent = indentOf(raw);
      if (openList?.kind === 'bullets') {
        const parent = openList.items[openList.items.length - 1];
        if (indent > bulletBaseIndent) parent.children.push(bullet[1]);
        else openList.items.push({ text: bullet[1], children: [], leadIn: LEAD_IN.test(bullet[1]) });
      } else {
        bulletBaseIndent = indent;
        blocks.push(openList = { kind: 'bullets', items: [{ text: bullet[1], children: [], leadIn: LEAD_IN.test(bullet[1]) }] });
      }
      openParagraph = null;
    } else if (numbered) {
      if (openList?.kind === 'numbered') openList.items.push(numbered[2]);
      else blocks.push(openList = { kind: 'numbered', start: Number(numbered[1]), items: [numbered[2]] });
      openParagraph = null;
    } else {
      openList = null;
      if (openParagraph && !afterBlank) openParagraph.lines.push(line);
      else blocks.push(openParagraph = { kind: 'paragraph', lines: [line] });
    }
    afterBlank = false;
  }
  return blocks;
}
