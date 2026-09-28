import { expect, test } from '@playwright/test';
import { gzipSync } from 'node:zlib';
import { writeFile } from 'node:fs/promises';

for (const throttled of [false, true]) {
  test(`mobile launch and navigation with normal motion${throttled ? ' and constrained CPU/network' : ''}`, async ({ page }, info) => {
    const session = await page.context().newCDPSession(page);
    if (throttled) {
      await session.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      await session.send('Network.emulateNetworkConditions', { offline: false, latency: 100,
        downloadThroughput: 200000, uploadThroughput: 100000 });
    }
    const requests: Record<string, number> = {};
    page.on('request', request => {
      const path = new URL(request.url()).pathname;
      if (path.startsWith('/api/')) requests[path] = (requests[path] ?? 0) + 1;
    });
    await page.addInitScript(() => {
      const metrics = { lcp: 0, cls: 0, longestTasks: [] as number[], eventDurations: [] as number[] };
      Object.assign(window, { workoutPerformance: metrics });
      for (const type of ['largest-contentful-paint', 'layout-shift', 'longtask', 'event']) {
        try {
          new PerformanceObserver(list => {
            for (const entry of list.getEntries()) {
              if (type === 'largest-contentful-paint') metrics.lcp = entry.startTime;
              if (type === 'layout-shift' && !(entry as PerformanceEntry & { hadRecentInput: boolean }).hadRecentInput)
                metrics.cls += (entry as PerformanceEntry & { value: number }).value;
              if (type === 'longtask') metrics.longestTasks.push(entry.duration);
              if (type === 'event') metrics.eventDurations.push(entry.duration);
            }
          }).observe({ type, buffered: true, ...(type === 'event' ? { durationThreshold: 16 } : {}) } as PerformanceObserverInit);
        } catch { /* The attached report identifies which browser metrics were available. */ }
      }
    });
    const shellResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/bootstrap/shell');
    const progressResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/progress');
    const historyResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/history/summaries');
    const start = Date.now();
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
    const usableMs = Date.now() - start;
    await expect(page.getByRole('region', { name: 'Workout history' })).toBeVisible();
    const responses = await Promise.all([shellResponse, progressResponse, historyResponse]);
    const startupGzipBytes = (await Promise.all(responses.map(async response => gzipSync(await response.body()).length))).reduce((a, b) => a + b, 0);
    const legacyResponse = await page.request.get('/api/bootstrap');
    expect(legacyResponse.ok()).toBe(true);
    const legacyGzipBytes = gzipSync(await legacyResponse.body()).length;
    const startupRequests = { ...requests };
    expect(startupRequests['/api/bootstrap/shell']).toBe(1);
    expect(startupRequests['/api/progress']).toBe(1);
    expect(startupRequests['/api/history/summaries']).toBe(1);
    expect(startupGzipBytes).toBeLessThanOrEqual(legacyGzipBytes * 0.75);
    // Paint observers deliver asynchronously after the heading becomes visible.
    await expect.poll(() => page.evaluate(() =>
      (window as Window & { workoutPerformance?: { lcp: number } }).workoutPerformance?.lcp ?? 0
    )).toBeGreaterThan(0);
    const launch = await page.evaluate(() => ({ metrics: (window as Window & { workoutPerformance?: unknown }).workoutPerformance,
      resources: performance.getEntriesByType('resource').map(entry => { const resource = entry as PerformanceResourceTiming;
        return { name: new URL(resource.name).pathname, bytes: resource.transferSize, duration: resource.duration }; }) }));
    const journeys: unknown[] = [];
    for (const route of ['/exercises', '/workouts', '/muscles', '/settings']) {
      await page.goto(route);
      await expect(page.locator('[data-page-heading]')).toBeVisible();
      if (route === '/exercises') {
        await page.getByRole('textbox', { name: 'Search exercises', exact: true }).fill('press');
        await expect(page.getByRole('textbox', { name: 'Search exercises', exact: true })).toHaveValue('press');
      }
      journeys.push({ route, metrics: await page.evaluate(() => (window as Window & { workoutPerformance?: unknown }).workoutPerformance) });
    }
    expect(requests['/api/bootstrap'] ?? 0).toBe(0);
    const measurements = await page.evaluate(() => ({
      metrics: (window as Window & { workoutPerformance?: unknown }).workoutPerformance,
      resources: performance.getEntriesByType('resource').map(entry => {
        const resource = entry as PerformanceResourceTiming;
        return { name: new URL(resource.name).pathname, bytes: resource.transferSize, duration: resource.duration };
      })
    }));
    const reportPath = info.outputPath('performance.json');
    await writeFile(reportPath, JSON.stringify({ throttled, usableMs, startupGzipBytes, legacyGzipBytes, startupRequests, requests, launch, journeys, ...measurements }, null, 2));
    await info.attach('performance.json', { path: reportPath, contentType: 'application/json' });
  });
}
