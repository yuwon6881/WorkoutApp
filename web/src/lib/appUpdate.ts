export async function applyAppUpdate(
  getRegistration: () => Promise<ServiceWorkerRegistration | undefined>,
  activate: () => Promise<void>,
  reload: () => void
): Promise<void> {
  // Another tab can activate the update before this tab's Reload button is clicked.
  // With no waiting worker, skip-waiting cannot trigger a controlling event.
  try {
    const registration = await getRegistration();
    if (registration?.waiting) {
      await activate();
      // Workbox may treat an update installed by another page as external and ignore it.
      // Message the actual waiting worker after the caller has installed its reload listener.
      registration.waiting.postMessage({type: 'SKIP_WAITING'});
    }
    else reload();
  } catch {
    reload();
  }
}
