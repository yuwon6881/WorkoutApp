import { ApiError } from './api';
import type { SaveState } from '../types';

type Task = { key: string; run: () => Promise<void> };
export type QueueStatus = { state: SaveState; message: string; pending: number };

/// One ordered pipeline for every write the app makes. Requests leave in the order they were
/// made, never in parallel, so the server's revision checks see a coherent sequence. A queued
/// task that has not started yet is replaced by a newer one with the same key, which is what
/// makes typing into a set a single eventual save rather than one request per keystroke.
export class SaveQueue {
  private queue: Task[] = [];
  private running = false;
  private listeners = new Set<(status: QueueStatus) => void>();
  private idleWaiters = new Set<() => void>();
  private status: QueueStatus = { state: 'idle', message: '', pending: 0 };

  subscribe(listener: (status: QueueStatus) => void) {
    this.listeners.add(listener);
    listener(this.status);
    return () => { this.listeners.delete(listener); };
  }

  get current() { return this.status; }
  /// True while work the user can see has not reached the server yet.
  get unsaved() { return this.running || this.queue.length > 0 || this.status.state === 'failed'; }

  set(state: SaveState, message = '') {
    this.status = { state, message, pending: this.queue.length };
    for (const listener of this.listeners) listener(this.status);
  }

  push(key: string, run: () => Promise<void>) {
    const waiting = this.queue.findIndex(task => task.key === key);
    if (waiting >= 0) this.queue[waiting] = { key, run };
    else this.queue.push({ key, run });
    this.set(this.status.state === 'failed' ? 'failed' : 'saving');
    void this.drain();
  }

  private async drain() {
    if (this.running) return;
    this.running = true;
    while (this.queue.length) {
      const task = this.queue.shift()!;
      this.set('saving');
      try {
        await task.run();
      } catch (error) {
        // A failure stops the pipeline: later writes were composed against state the server
        // has now rejected, so replaying them would save something the user never saw.
        this.queue = [];
        this.running = false;
        const failure = error instanceof ApiError ? error : new ApiError('Something went wrong. Try again.', -1);
        this.set(failure.signedOut ? 'signed-out' : failure.offline ? 'offline' : 'failed', failure.message);
        this.resolveIdleWaiters();
        return;
      }
    }
    this.running = false;
    this.set('saved');
    this.resolveIdleWaiters();
  }

  /// Waits for writes already in this serial queue. Finish uses this before it enqueues the
  /// server-side completion so an in-flight save cannot race or be silently discarded.
  async whenIdle(): Promise<void> {
    if (this.running || this.queue.length > 0) await new Promise<void>(resolve => this.idleWaiters.add(resolve));
    if (this.status.state === 'offline' || this.status.state === 'failed' || this.status.state === 'signed-out')
      throw new ApiError(this.status.message || 'A workout change still needs attention.', this.status.state === 'signed-out' ? 401 : this.status.state === 'offline' ? 0 : 409);
  }

  private resolveIdleWaiters(): void {
    if (this.running || this.queue.length > 0) return;
    for (const resolve of this.idleWaiters) resolve();
    this.idleWaiters.clear();
  }

  clear() { this.queue = []; this.running = false; this.set('idle'); this.resolveIdleWaiters(); }
}
