/// Extracts every PDF in a folder the way the browser does before an import: the page text the
/// reader rebuilds and the exercise demo links, one JSON file per PDF, for tests/Corpus/CorpusReport.
///
///   node node_modules/vite-node/vite-node.mjs scripts/pdf-corpus.ts <pdf folder> <out folder>
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { buildPageText } from '../src/lib/pdfText';
import { pageLinks, printedLinks, type LinkRect } from '../src/lib/pdfLinks';
import type { TextPiece } from '../src/lib/pdfGeometry';

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('Usage: pdf-corpus.ts <pdf folder> <out folder>');
mkdirSync(output, { recursive: true });

for (const file of readdirSync(input).filter(name => name.toLowerCase().endsWith('.pdf'))) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(join(input, file))), disableFontFace: true, useSystemFonts: false }).promise;
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
    links.push(...pageLinks(number, pieces, annotations));
    const text = buildPageText(pieces);
    // The browser submits printed addresses beside annotations (pdfText.ts), so the corpus must too.
    links.push(...printedLinks(number, text));
    if (text.length > 0) pages.push({ page: number, text });
    page.cleanup();
  }
  const name = basename(file, '.pdf').replace(/\s+/g, '_');
  writeFileSync(join(output, `${name}.json`), JSON.stringify({ pageCount: doc.numPages, pages, links }));
  console.log(`${name}: ${doc.numPages} pages, ${pages.length} with text, ${links.length} links`);
  await doc.destroy();
}
