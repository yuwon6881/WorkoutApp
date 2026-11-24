import {coordinateLaunchRequest} from './launchRequests';
/** Repeat safe reads and explicitly idempotent writes. */
export async function fetchWithAvailabilityRecovery(url: string, options: RequestInit, safe: boolean | 'workout-start', timeoutMs?: number): Promise<Response> {
  const controller = new AbortController();
  const deadline = timeoutMs === undefined ? Infinity : Date.now() + timeoutMs;
  const timer = timeoutMs === undefined ? undefined : setTimeout(() => controller.abort(
    new DOMException('The service is taking longer than expected. Try again shortly.', 'TimeoutError')), timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  const startingWorkout = safe === 'workout-start';
  const maxRetries = startingWorkout ? 4 : 2;
  try {
    return await coordinateLaunchRequest(url, options.method ?? 'GET', signal, async () => {
      for (let attempt = 0; ; attempt++) {
        signal.throwIfAborted();
        const attemptSignal = startingWorkout ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : signal;
        const startupBackoff = 2000 * 2 ** attempt;
        let response: Response;
        try {
          response = await fetch(url, {...options, signal: attemptSignal});
          const temporary = response.status === 429 || startingWorkout && [500, 502, 503, 504].includes(response.status);
          if (!safe || !temporary || attempt >= maxRetries) return await completeResponse(response);
        } catch (error) {
          if (!startingWorkout || signal.aborted || attempt >= maxRetries ||
            !(error instanceof TypeError || attemptSignal.aborted) || Date.now() + startupBackoff >= deadline) throw error;
          await waitForRetry(startupBackoff, signal);
          continue;
        }
        const raw = response.headers.get('Retry-After');
        const seconds = raw !== null && /^\d+$/.test(raw) ? Number(raw) : null;
        const date = raw !== null ? Date.parse(raw) : NaN;
        // Platform startup rejections lack Retry-After; allow startup without multiplying deadlines.
        const delay = Math.max(250, seconds !== null ? seconds * 1000
          : Number.isFinite(date) ? Math.max(0, date - Date.now()) : response.status === 429 ? 5000 * (attempt + 1) : startupBackoff);
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
