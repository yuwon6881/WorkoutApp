import {coordinateLaunchRequest} from './launchRequests';
/** Repeat explicitly safe reads / idempotent sync passes, never ordinary writes. */
export async function fetchWithAvailabilityRecovery(url: string, options: RequestInit, safe: boolean, timeoutMs?: number): Promise<Response> {
  const controller = new AbortController();
  const deadline = timeoutMs === undefined ? Infinity : Date.now() + timeoutMs;
  const timer = timeoutMs === undefined ? undefined : setTimeout(() => controller.abort(
    new DOMException('The service is taking longer than expected. Try again shortly.', 'TimeoutError')), timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  try {
    return await coordinateLaunchRequest(url, options.method ?? 'GET', signal, async () => {
      for (let attempt = 0; ; attempt++) {
        signal.throwIfAborted();
        const response = await fetch(url, {...options, signal});
        if (!safe || response.status !== 429 || attempt >= 2) return await completeResponse(response);
        const raw = response.headers.get('Retry-After');
        const seconds = raw !== null && /^\d+$/.test(raw) ? Number(raw) : null;
        const date = raw !== null ? Date.parse(raw) : NaN;
        // Platform startup rejections lack Retry-After; allow startup without multiplying deadlines.
        const delay = Math.max(250, seconds !== null ? seconds * 1000
          : Number.isFinite(date) ? Math.max(0, date - Date.now()) : 5000 * (attempt + 1));
        if (delay > 60000 || delay >= deadline - Date.now()) return await completeResponse(response);
        await response.body?.cancel();
        await waitForRetry(delay, signal);
      }
    });
  } finally { if (timer !== undefined) clearTimeout(timer); }
}
function waitForRetry(delay: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, delay);
    signal.addEventListener('abort', abort, {once: true});
  });
}

async function completeResponse(response: Response): Promise<Response> {
  if (response.body === null || [204, 205, 304].includes(response.status)) return response;
  // Include the response body in the absolute deadline rather than stopping at its headers.
  const body = await response.arrayBuffer();
  return new Response(body, {status: response.status, statusText: response.statusText, headers: response.headers});
}
