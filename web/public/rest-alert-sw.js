/// Imported by the generated service worker. Its only job is the rest-timer notification:
/// tapping it should put the user back in the workout they are already in the middle of,
/// not open a second copy of the app.
self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let payload;
    try { payload = event.data?.json(); } catch { return; }
    const data = payload && typeof payload.data === 'object' && payload.data ? payload.data : payload;
    if (data?.kind !== 'workout-rest') return;

    let requested;
    try { requested = new URL(typeof data.route === 'string' ? data.route : '/', self.location.origin); }
    catch { requested = new URL('/', self.location.origin); }
    const sessionId = typeof data.sessionId === 'string' ? data.sessionId : '';
    const generation = typeof data.generation === 'string' ? data.generation : '';
    if (requested.origin !== self.location.origin || !/^[a-f0-9-]{36}$/i.test(sessionId) ||
      requested.searchParams.get('workout') !== sessionId || !/^[a-f0-9-]{36}$/i.test(generation)) return;
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (await visibleWorkoutOwnsAlert(windows, sessionId, generation)) return;

    const destination = new URL('/', self.location.origin);
    destination.searchParams.set('workout', sessionId);
    await self.registration.showNotification('Rest timer', {
      body: 'Your rest is over. Open Workout to continue.',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: `workout-rest-${sessionId}`,
      renotify: false,
      data: { url: destination.href }
    });
  })());
});

/// Ask each visible app window whether its authenticated, account-scoped timer owns this exact
/// session and generation. A missing or suspended client fails open so an unrelated window can
/// never suppress the only alert.
async function visibleWorkoutOwnsAlert(windows, sessionId, generation) {
  const visible = windows.filter(client => {
    try { return client.visibilityState === 'visible' && new URL(client.url).origin === self.location.origin; }
    catch { return false; }
  });
  const replies = await Promise.all(visible.map(client => new Promise(resolve => {
    const channel = new MessageChannel();
    let settled = false;
    const finish = owned => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try { channel.port1.close(); } catch { /* the browser may already have closed the reply port */ }
      resolve(owned);
    };
    const timeout = setTimeout(() => finish(false), 300);
    channel.port1.onmessage = event => {
      const reply = event.data;
      finish(reply?.type === 'workout-rest-alert-owner-response' &&
        reply.sessionId === sessionId && reply.generation === generation && reply.ownsTimer === true);
    };
    channel.port1.start?.();
    try {
      client.postMessage({ type: 'workout-rest-alert-owner-query', sessionId, generation }, [channel.port2]);
    } catch { finish(false); }
  })));
  return replies.some(Boolean);
}

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const requestedUrl = event.notification.data && event.notification.data.url;
    const target = typeof requestedUrl === 'string' ? new URL(requestedUrl, self.location.origin) : new URL('/', self.location.origin);
    if (target.origin !== self.location.origin) target.pathname = '/';
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = clients.find(client => new URL(client.url).origin === self.location.origin);
    if (open) {
      if ('navigate' in open) await open.navigate(target.href);
      await open.focus();
      return;
    }
    await self.clients.openWindow(target.href);
  })());
});
