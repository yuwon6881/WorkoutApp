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
        return;
      }
    }
    this.running = false;
    this.set('saved');
  }

  clear() { this.queue = []; this.running = false; this.set('idle'); }
}
