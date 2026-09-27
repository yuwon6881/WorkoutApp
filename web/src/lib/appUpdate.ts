export async function applyAppUpdate(
  getRegistration: () => Promise<ServiceWorkerRegistration | undefined>,
  activate: () => Promise<void>,
  reload: () => void
): Promise<void> {
  // Another tab can activate the update before this tab's Reload button is clicked.
  // With no waiting worker, skip-waiting cannot trigger a controlling event.
  try {
    const registration = await getRegistration();
    if (registration?.waiting) await activate();
    else reload();
  } catch {
    reload();
  }
}
