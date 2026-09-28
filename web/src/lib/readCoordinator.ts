type Read = { controller: AbortController; promise: Promise<unknown>; subscribers: number };

/** Shares in-flight reads only. No training responses survive in this coordinator. */
export class ReadCoordinator {
  private reads = new Map<string, Read>();
  private active = 0;
  private waiting: Array<() => void> = [];

  constructor(private readonly concurrency = 3) {}

  reset() {
    for (const read of this.reads.values()) read.controller.abort();
    this.reads.clear();
  }

  run<T>(key: string, signal: AbortSignal | undefined, load: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (signal?.aborted) return Promise.reject(new DOMException('Read cancelled.', 'AbortError'));
    let read = this.reads.get(key);
    if (!read) {
      const controller = new AbortController();
      const next: Read = { controller, subscribers: 0, promise: Promise.resolve() };
      next.promise = this.schedule(controller.signal, () => load(controller.signal)).finally(() => {
        if (this.reads.get(key) === next) this.reads.delete(key);
      });
      read = next;
      this.reads.set(key, read);
    }
    const shared = read;
    shared.subscribers++;
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const finish = (action: () => void) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', abort);
        shared.controller.signal.removeEventListener('abort', abort);
        if (--shared.subscribers === 0) {
          shared.controller.abort();
          if (this.reads.get(key) === shared) this.reads.delete(key);
        }
        action();
      };
      const abort = () => finish(() => reject(new DOMException('Read cancelled.', 'AbortError')));
      signal?.addEventListener('abort', abort, { once: true });
      shared.controller.signal.addEventListener('abort', abort, { once: true });
      shared.promise.then(value => finish(() => resolve(value as T)), error => finish(() => reject(error)));
    });
  }

  private async schedule<T>(signal: AbortSignal, load: () => Promise<T>): Promise<T> {
    if (this.active >= this.concurrency) await new Promise<void>(resolve => this.waiting.push(resolve));
    else this.active++;
    try {
      if (signal.aborted) throw new DOMException('Read cancelled.', 'AbortError');
      return await load();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    }
  }
}

export const sharedReads = new ReadCoordinator();
