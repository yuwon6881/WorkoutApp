export type AiMessageBlock =
  | { kind: 'heading'; text: string }
  | { kind: 'paragraph'; lines: string[] }
  | { kind: 'bullets'; items: string[] }
  | { kind: 'numbered'; start: number; items: string[] };

const HEADING = /^#{1,6}\s+(.+)$/;
const BULLET = /^[-*•]\s+(.+)$/;
const NUMBERED = /^(\d+)[.)]\s+(.+)$/;

/**
 * Splits an assistant reply into the few block shapes the chat renders. Only lists, headings, and
 * paragraphs are recognised: the reply is model output, so anything richer stays plain text.
 * A blank line between two items of one list does not end the list, because models often
 * separate numbered steps that way.
 */
export function parseAiMessage(content: string): AiMessageBlock[] {
  const blocks: AiMessageBlock[] = [];
  let openList: Extract<AiMessageBlock, { kind: 'bullets' | 'numbered' }> | null = null;
  let openParagraph: Extract<AiMessageBlock, { kind: 'paragraph' }> | null = null;
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
      if (openList?.kind === 'bullets') openList.items.push(bullet[1]);
      else blocks.push(openList = { kind: 'bullets', items: [bullet[1]] });
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
