export type DevicePreferences = { sound: boolean; vibration: boolean; keepAwake: boolean };

export const defaultDevicePreferences: DevicePreferences = { sound: true, vibration: false, keepAwake: false };

export async function loadDevicePreferences(accountId: string): Promise<DevicePreferences> {
  try {
    const raw = localStorage.getItem(`workout.device-preferences.v1:${accountId}`);
    if (!raw) return defaultDevicePreferences;
    const value = JSON.parse(raw) as Partial<DevicePreferences>;
    return { sound: value.sound !== false, vibration: value.vibration === true, keepAwake: value.keepAwake === true };
  } catch { return defaultDevicePreferences; }
}

export async function saveDevicePreferences(accountId: string, value: DevicePreferences): Promise<void> {
  try { localStorage.setItem(`workout.device-preferences.v1:${accountId}`, JSON.stringify(value)); }
  catch { /* device settings are a convenience and do not block training */ }
}
