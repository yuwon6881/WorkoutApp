type Snapshot = { version: unknown; value: unknown; at: number };

/** Small, transient UI snapshots. Never written to browser storage or the service worker. */
export class ViewReadCache {
  private values = new Map<string, Snapshot>();

  get<T>(key: string, version: unknown): T | undefined {
    const snapshot = this.values.get(key);
    return snapshot && snapshot.version === version ? snapshot.value as T : undefined;
  }

  fresh(key: string, version: unknown, now = Date.now()): boolean {
    const snapshot = this.values.get(key);
    return Boolean(snapshot && snapshot.version === version && now - snapshot.at < 30_000);
  }

  set<T>(key: string, version: unknown, value: T) {
    this.values.delete(key);
    this.values.set(key, { version, value, at: Date.now() });
    if (this.values.size > 24) this.values.delete(this.values.keys().next().value!);
  }

  reset() { this.values.clear(); }
}

export const viewReadCache = new ViewReadCache();
