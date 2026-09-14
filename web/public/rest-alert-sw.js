/// Imported by the generated service worker. Its only job is the rest-timer notification:
/// tapping it should put the user back in the workout they are already in the middle of,
/// not open a second copy of the app.
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = clients.find(client => new URL(client.url).origin === self.location.origin);
    if (open) { await open.focus(); return; }
    await self.clients.openWindow('/');
  })());
});
