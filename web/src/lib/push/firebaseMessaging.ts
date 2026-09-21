import type { FirebaseApp } from 'firebase/app';
import type { Messaging } from 'firebase/messaging';
import { getFirebaseConfig, getVapidKey } from './firebaseConfig';

const DEVICE_KEY = 'workout.push-device.v1';
let appInstance: FirebaseApp | null = null;
let messagingInstance: Messaging | null = null;

export function getWorkoutPushDeviceId(): string | null {
  try {
    const saved = localStorage.getItem(DEVICE_KEY);
    if (saved && /^[a-zA-Z0-9_-]{16,200}$/.test(saved)) return saved;
    const id = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(DEVICE_KEY, id);
    return id;
  } catch {
    return null;
  }
}

async function getMessagingInstance(): Promise<Messaging | null> {
  if (messagingInstance) return messagingInstance;
  const config = getFirebaseConfig();
  if (!config) return null;
  const [{ initializeApp }, { getMessaging, isSupported }] = await Promise.all([
    import('firebase/app'), import('firebase/messaging')
  ]);
  if (!(await isSupported())) throw new Error('This browser does not support push notifications.');
  appInstance ??= initializeApp(config);
  messagingInstance = getMessaging(appInstance);
  return messagingInstance;
}

export async function registerWorkoutPushDevice(): Promise<{ deviceId: string; token: string }> {
  const deviceId = getWorkoutPushDeviceId();
  if (!deviceId) throw new Error('This browser could not save a device identifier. Check browser storage settings.');
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted')
    throw new Error('Allow notifications in this browser first.');
  const vapidKey = getVapidKey();
  if (!vapidKey) throw new Error('Push notifications are not configured for Workout yet.');
  if (!('serviceWorker' in navigator)) throw new Error('This browser cannot register notifications.');
  const registration = await navigator.serviceWorker.ready;
  const messaging = await getMessagingInstance();
  if (!messaging) throw new Error('Push notifications are not configured for Workout yet.');
  const { getToken } = await import('firebase/messaging');
  const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: registration });
  if (!token) throw new Error('The browser push service did not return a device registration.');
  return { deviceId, token };
}

export async function deleteWorkoutPushToken(): Promise<void> {
  const messaging = await getMessagingInstance();
  if (!messaging) return;
  const { deleteToken } = await import('firebase/messaging');
  await deleteToken(messaging);
}
