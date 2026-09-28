import type { TextPiece } from './pdfGeometry';

/** At most the existing one/two page decoding batch can be pending. */
export class PdfPageReconstructor {
  private worker: Worker | null = null;
  private nextId = 0;
  private disposed = false;
  private pending = new Map<number, { resolve: (text: string) => void; reject: (error: Error) => void }>();

  async build(items: readonly TextPiece[]): Promise<string> {
    if (this.disposed) throw new Error('PDF import cancelled.');
    if (typeof Worker === 'undefined') {
      const { buildPageText } = await import('./pdfPageText');
      return buildPageText(items);
    }
    if (!this.worker) {
      this.worker = new Worker(new URL('./pdfPageText.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (event: MessageEvent<{ id: number; text?: string; error?: string }>) => {
        const pending = this.pending.get(event.data.id);
        this.pending.delete(event.data.id);
        if (event.data.error) pending?.reject(new Error(event.data.error));
        else pending?.resolve(event.data.text ?? '');
      };
      this.worker.onerror = () => this.dispose(new Error('PDF reconstruction worker could not run. Reopen the app and retry.'));
    }
    const id = ++this.nextId;
    return new Promise<string>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try { this.worker!.postMessage({ id, items }); }
      catch (error) { this.pending.delete(id); reject(error); }
    });
  }

  dispose(error = new Error('PDF import cancelled.')) {
    this.disposed = true;
    this.worker?.terminate();
    this.worker = null;
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}
