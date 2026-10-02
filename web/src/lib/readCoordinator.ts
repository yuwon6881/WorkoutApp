type Read = { controller: AbortController; promise: Promise<unknown>; subscribers: number };
type Waiting = { priority: number; signal: AbortSignal; start: () => void; cancel: () => void };

/** Shares in-flight reads only. No training responses survive in this coordinator. */
export class ReadCoordinator {
  private reads = new Map<string, Read>();
  private active = 0;
  private optionalActive = 0;
  private waiting: Waiting[] = [];

  constructor(private readonly concurrency = 3) {}

  reset() {
    for (const read of this.reads.values()) read.controller.abort();
    this.reads.clear();
  }

  run<T>(key: string, signal: AbortSignal | undefined, load: (signal: AbortSignal) => Promise<T>, priority = 1): Promise<T> {
    if (signal?.aborted) return Promise.reject(new DOMException('Read cancelled.', 'AbortError'));
    let read = this.reads.get(key);
    if (!read) {
      const controller = new AbortController();
      const next: Read = { controller, subscribers: 0, promise: Promise.resolve() };
      next.promise = this.schedule(controller.signal, () => load(controller.signal), priority).finally(() => {
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

  private async schedule<T>(signal: AbortSignal, load: () => Promise<T>, priority: number): Promise<T> {
    if (!this.canStart(priority)) await new Promise<void>((resolve, reject) => {
      const waiting: Waiting = { priority, signal, start: () => { this.admit(priority); resolve(); }, cancel: () => {
        this.waiting = this.waiting.filter(item => item !== waiting);
        reject(new DOMException('Read cancelled.', 'AbortError'));
      } };
      this.waiting.push(waiting);
      signal.addEventListener('abort', waiting.cancel, { once: true });
    });
    else this.admit(priority);
    try {
      if (signal.aborted) throw new DOMException('Read cancelled.', 'AbortError');
      return await load();
    } finally {
      this.active--;
      if (priority >= 2) this.optionalActive--;
      this.waiting.sort((left, right) => left.priority - right.priority);
      // Reserve each admitted slot before its async continuation resumes.
      const next = this.waiting.find(item => !item.signal.aborted && this.canStart(item.priority));
      if (next) {
        this.waiting = this.waiting.filter(item => item !== next);
        next.signal.removeEventListener('abort', next.cancel);
        next.start();
      }
    }
  }

  private canStart(priority: number) {
    return this.active < this.concurrency && (priority < 2 || this.optionalActive === 0);
  }

  private admit(priority: number) {
    this.active++;
    if (priority >= 2) this.optionalActive++;
  }
}

export const sharedReads = new ReadCoordinator();
