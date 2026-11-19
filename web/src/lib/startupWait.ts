export const STARTUP_STORAGE_TIMEOUT_MS = 10_000;

export class StartupStorageTimeoutError extends Error {
  constructor() {
    super('Saved workout recovery is taking longer than expected. Reload the app to try again.');
    this.name = 'StartupStorageTimeoutError';
  }
}

export function waitForStartupStorage<T>(operation: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new StartupStorageTimeoutError()), STARTUP_STORAGE_TIMEOUT_MS);
    operation.then(
      value => { clearTimeout(timer); resolve(value); },
      failure => { clearTimeout(timer); reject(failure); }
    );
  });
}