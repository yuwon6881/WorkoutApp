import { buildPageText } from './pdfPageText';
import type { TextPiece } from './pdfGeometry';

self.onmessage = (event: MessageEvent<{ id: number; items: TextPiece[] }>) => {
  try { self.postMessage({ id: event.data.id, text: buildPageText(event.data.items) }); }
  catch (error) { self.postMessage({ id: event.data.id, error: error instanceof Error ? error.message : 'PDF page reconstruction failed.' }); }
};
