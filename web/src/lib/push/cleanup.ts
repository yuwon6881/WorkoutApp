const CLEANUP_TIMEOUT_MS = 1500;

/** Best-effort revocation keeps logout responsive if the API or FCM is unavailable. */
export async function retireWorkoutPushDevice(
  deviceId: string | null,
  revokeCurrentRegistration: (() => Promise<unknown>) | undefined,
  deleteLocalToken: () => Promise<unknown>
): Promise<void> {
  if (deviceId && revokeCurrentRegistration) await attempt(revokeCurrentRegistration);
  await attempt(deleteLocalToken);
}

/** Called after authenticating the new account; never use its credentials to target the prior account. */
export async function retireWorkoutPushAfterAccountSwitch(
  previousAccountId: string | null,
  currentAccountId: string,
  deviceId: string | null,
  revokeCurrentRegistration: (() => Promise<unknown>) | undefined,
  deleteLocalToken: () => Promise<unknown>
): Promise<boolean> {
  if (!previousAccountId || previousAccountId === currentAccountId) return false;
  await retireWorkoutPushDevice(deviceId, revokeCurrentRegistration, deleteLocalToken);
  return true;
}

async function attempt(action: () => Promise<unknown>): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      action(),
      new Promise<void>(resolve => { timeout = setTimeout(resolve, CLEANUP_TIMEOUT_MS); })
    ]);
  } catch { /* Push cleanup must not block sign-out or authentication recovery. */ }
  finally { if (timeout) clearTimeout(timeout); }
}
