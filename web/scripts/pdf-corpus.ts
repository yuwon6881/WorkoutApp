/// Extracts every PDF in a folder the way the browser does before an import: the page text the
/// reader rebuilds and the exercise demo links, one JSON file per PDF, for tests/Corpus/CorpusReport.
///
///   node node_modules/vite-node/vite-node.mjs scripts/pdf-corpus.ts <pdf folder> <out folder>
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { createHash } from 'node:crypto';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { buildPageText } from '../src/lib/pdfText';
import { MAX_PDF_LINKS, pageLinks, preferredPageLinks, printedLinks, type LinkRect } from '../src/lib/pdfLinks';
import type { TextPiece } from '../src/lib/pdfGeometry';

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('Usage: pdf-corpus.ts <pdf folder> <out folder>');
mkdirSync(output, { recursive: true });

for (const file of readdirSync(input).filter(name => name.toLowerCase().endsWith('.pdf'))) {
  const name = basename(file, '.pdf').replace(/\s+/g, '_');
  const filter = process.env.WORKOUT_CORPUS_FILTER?.split(',').map(value => value.trim());
  if (filter && !filter.includes(name)) continue;
  const bytes = readFileSync(join(input, file));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), disableFontFace: true, useSystemFonts: false }).promise;
  const pages: { page: number; text: string }[] = [];
  const links: ReturnType<typeof pageLinks> = [];
  for (let number = 1; number <= doc.numPages; number++) {
    const page = await doc.getPage(number);
    const content = await page.getTextContent();
    const pieces: TextPiece[] = content.items.flatMap(item => 'str' in item
      ? [{ str: item.str, transform: item.transform, width: item.width, height: item.height }] : []);
    const annotations: LinkRect[] = (await page.getAnnotations({ intent: 'display' }))
      .flatMap(annotation => annotation.subtype === 'Link' && typeof annotation.url === 'string'
        ? [{ url: annotation.url as string, rect: annotation.rect as LinkRect['rect'] }] : []);
    const text = buildPageText(pieces);
    links.push(...preferredPageLinks(pageLinks(number, pieces, annotations), printedLinks(number, text))
      .slice(0, MAX_PDF_LINKS - links.length));
    if (text.length > 0) pages.push({ page: number, text });
    page.cleanup();
  }
  writeFileSync(join(output, `${name}.json`), JSON.stringify({ sourceFile: file, sha256, pageCount: doc.numPages, pages, links }));
  console.log(`${name}: ${doc.numPages} pages, ${pages.length} with text, ${links.length} links`);
  await doc.destroy();
}
