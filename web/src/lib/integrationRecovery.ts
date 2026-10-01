/** One recovery timer per integration, with a finite retry allowance for each failure episode. */
export class IntegrationRecovery {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private attempts = 0;

  schedule(run: () => Promise<unknown>, delay = 5000) {
    if (this.timer !== undefined || this.attempts >= 2) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (typeof document !== 'undefined' && (document.visibilityState !== 'visible' || !navigator.onLine)) return;
      this.attempts++;
      // The integration publishes failures to its existing status surface.
      void run().catch(() => undefined);
    }, Math.max(0, delay));
  }

  reset() {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.attempts = 0;
  }
}
