export type DevicePreferences = { sound: boolean; vibration: boolean; keepAwake: boolean; autoAdvance: boolean };

// A phone in the gym is the common case: feedback you can feel, a screen that stays on during the
// workout, and moving to the next exercise once one is done. Each can be switched off per device.
export const defaultDevicePreferences: DevicePreferences = { sound: true, vibration: true, keepAwake: true, autoAdvance: true };

export async function loadDevicePreferences(accountId: string): Promise<DevicePreferences> {
  try {
    const raw = localStorage.getItem(`workout.device-preferences.v1:${accountId}`);
    if (!raw) return defaultDevicePreferences;
    const value = JSON.parse(raw) as Partial<DevicePreferences>;
    return { sound: value.sound !== false, vibration: value.vibration !== false, keepAwake: value.keepAwake !== false, autoAdvance: value.autoAdvance !== false };
  } catch { return defaultDevicePreferences; }
}

export async function saveDevicePreferences(accountId: string, value: DevicePreferences): Promise<void> {
  try { localStorage.setItem(`workout.device-preferences.v1:${accountId}`, JSON.stringify(value)); }
  catch { /* device settings are a convenience and do not block training */ }
}
